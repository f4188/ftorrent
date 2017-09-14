
const benDecode = require('bencode').decode 
const benEncode = require('bencode').encode
const async = require('async')
const speedometer = require('speedometer')
EventEmitter = require('events').EventEmitter
const randomAccessFile = require('random-access-file')
const path = require("path")
const util = require('util')
const crypto = require('crypto')
const net = require('net')
const fs = require('graceful-fs')
const querystring = require('querystring')
const url = require('url')

const NSet = require('../lib/NSet.js').NSet
const NMap = require('../lib/NSet.js').NMap
const ActivePieces = require('./piece.js').ActivePieces
const Pieces = require('./piece.js').Pieces
const UDPTracker = require('../tracker/index.js').UDPTracker
const HTTPTracker = require('../tracker/index.js').HTTPTracker
const DHT = require('../dht/index.js').DHT
const BitTorrentMsgParser = require('../peer/bittorrentmsgparser.js').Parser

var _Peer = require('../peer/index.js').Peer
var UTMetaDataEx = require('../metadata_exchange/index.js').UTMetaDataEx
var PeerEx = require('../peer_exchange/index.js').PeerEx

const Peer = PeerEx(UTMetaDataEx(_Peer))

const MAX_NUM_PEERSTATS = 2000 //
const SOFT_MIN_CONNECTIONS = 50
const SOFT_MIN_INTERESTED = 25
const SOFT_MIN_UNCHOKED = 15
const HARD_MAX_CONNECTIONS = 100
const HARD_MAX_UNCHOKE = 50
const SOFT_MAX_CONNECTIONS = 50
const KEEP_ALIVE_INTERVAL = 30 * 1e3
const PEER_CONNECT_TIMEOUT = 3 * 1e3
const CONNECT_LOOP_INTERVAL = 60 * 1e3
const PRUNE_IGNORE_TIME = 60 * 1e3 
const MIN_UP_RATE = 1 * 1e3 

const NUM_REQUESTS_PER_PEER = 1 // 2
const NUM_REQUESTS_TOTAL = 200 //
const NUM_ACTIVE_PIECES = 50
const MAX_NUM_OPT_UNCHOKE = 4
const MAX_NUM_MUTUAL_UNCHOKE = 12
const OPT_LOOP_INTERVAL = 30 * 1e3
const UNCHOKE_LOOP_INTERVAL = 10 * 1e3
const SEED_LOOP_INTERVAL = 30 * 1e3
const ANNOUNCE_LOOP_INTERVAL = 10 * 60 * 1e3
const ENABLE_DHT = false
const DHT_PORT = 8000

const INITIALIZE_DHT = false

const DOWNLOAD_DIRECTORY = "./"

LOG = false

var createDirectory = (dirName) => {

	if ( fs.existsSync(dirName) )
		return true

	fs.mkdirSync(dirName)

}

var byFreq2 = ( arrSet ) => {

	let freqs = new Map()

	for(var set of arrSet) 
		for(var pIdx of set) {

			let count = freqs.get(pIdx)
			if(count || count == 0)
				freqs.set(pIdx, ++count)
			else 
				freqs.set(pIdx, 0) 

		}

	return Array.from(freqs.entries()).sort( (p1, p2) => p1[1] - p2[1])
}

class Swarm extends EventEmitter {

	constructor(fileMetaData, download, myIP, myPort) {

		super()

		this.peerStats = new NMap()
		this.peers = new NSet()//new NMap()
		this.connLoop = null
		this.acceptServerConn = true
		
		this.fileMetaData = fileMetaData
		this.download = download
		//this.seeding = false

		this.defaultTimeout = 3 * PEER_CONNECT_TIMEOUT
		
		this.myIP = myIP
		this.myPort = myPort

		this.startTime = null

		this.globalDownRate = 0
		this.gDSpeed =  speedometer(5)
		this.globalUpRate = 0
		this.gUSpeed = speedometer(5)

		let self = this

		this.listeners = {

			//, { added : added, added6 : added6, dropped : dropped, dropped6 : dropped6 })
			'peer_exchange' : [ (arg) => {

				let { added, added6, dropped, dropped6 } = arg
				//ignore added6
				if(LOG)
					console.log("adding:", added)

				self.addPeers(added)

			}],

			'connected' : [( peer ) => {

				self.peers.add(peer)

				if(!self.peerStats.has(peer.peerID)) {

					let stats =  { 'disconnects' : 0, 'firstConnect' : Date.now(), host : peer.sock.remoteAddress, 
						port : peer.sock.remotePort, status : 1, online : 1, dSpeed : speedometer(60), 
						downRate : 0, uSpeed : speedometer(60), upRate : 0 }

					self.peerStats.set(peer.peerID, stats)
					self.peerStats.set(stats.host + ":" + stats.port, stats)

					peer.sock.on('data', (data) => { stats.downRate = stats.dSpeed(data.length) ; self.globalDownRate = self.gDSpeed(data.length) } )
					peer.on('data', (data) => { stats.upRate = stats.uSpeed(data.length); self.globalUpRate = self.gUSpeed(data.length) } )

				}

				else 
					self.peerStats.get(peer.peerID).status = 1

				self.emit('new_peer', peer)


			}],

			'disconnected' : [( peer ) => {

				self.peers.delete(peer)
				self.peerStats.get(peer.peerID).disconnects++
				self.peerStats.get(peer.peerID).status = 0
				self.emit('peer_disconnected')

			}], 

			'peer_interested' : [() => {

				self.emit('peer_interested')

			}],

			'peer_unchoked' : [() => {

				self.emit('peer_unchoked')

			}],

			'peer_choked' : [() => {

				self.emit('peer_choked')

			}],

			'new_pieces' : [(peer) => {

				self.emit('new_pieces')

			}],

		}

		var sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

		//this.UTPserver = uTP.createServer() // ...

		this.TCPserver = net.createServer(sockOpts, ( sock ) => {
			
			self.pruneConnections(true)

			if(LOG)
				console.log('accepting connection')

			if( self.acceptPeerConnCond() > 0 && self.acceptServerConn)
				self.makePeer(sock)
			//else sock.end()

		})

		this.TCPserver.listen(this.myPort)

	}

	start() {

		//this.seeding = seeding
		this.acceptServerConn = true
		this.connLoop = setInterval( (this.connectManager).bind(this), CONNECT_LOOP_INTERVAL )

	}

	stop() {

		this.acceptServerConn = false
		clearInterval(this.connLoop) 

	}

	//disconnect peers that are seeding if seeding
	//disconnect peers that refuse requests
	//disconnect peers that never unchoke even when interested (in me)

	//get connections under limit by randomly disconnecting slow peers or infrequent or short time unchokers (1)
	//peer leeching but mutually uninterested

	//average total bandwidth available
	// Z peeri * upload speed < average total bandwidth
	//randomly disconnect one at a time from(1) and monitor download speed - stop when download speed decreases

	//called periodically and also when new peers available
	pruneConnections(avail) { //prunes idle or bad peers - peers that never unchoke despite interest - slow peers 

		//if(LOG)
		//	console.log("Prune connections")

		let self = this, seeding = this.download.seeding

		//average rate to top five downloaders 
		if(avail || (this.peers.size > SOFT_MAX_CONNECTIONS )) { //be liberal 

			let fiveRate = this.peerStats.filter(x => x.status == 1).getArray().map( x => x.downRate ).sort( (s1, s2) => s2 - s1 ).slice(0, 10)
			fiveRate = fiveRate.reduce( (sum, rate) => sum + rate, 0) / 10

			this.peers.forEach( peer => {

				let stats = self.peerStats.get(peer.peerID)
				let time = Date.now - stats.firstConnect

				if(!seeding && time > PRUNE_IGNORE_TIME  && stats.downRate < fiveRate / 5 ) //prune by percentile ?? 
					peer.sock.end()
				if(seeding && time > PRUNE_IGNORE_TIME && stats.upRate < MIN_UP_RATE && peer.interested) 
					peer.sock.end()

			})
			

		}

	}

	connectManager(starting) {

		let self = this

		var _addPeer = async function (addr, callback) {

			try {

				let peer = await self.connectPeer(addr)
				self.peers.add(peer)

			} catch (error) {

				//if(LOG)
				//	console.log(error)

			}

			callback()
		
		}

		this.pruneConnections(true)

		let numAddrs = this.connectMorePeersCond()

		if(numAddrs > 0) {

			if(starting) 
				numAddrs = 200

			let addrs = this.peerStats.filter( stat => stat.online == 1 && stat.status == 0 && stat.disconnects == null).getArray()

			if(addrs.length < numAddrs) {
				let prevCon = this.peerStats.filter( stat => stat.online == 1 && stat.status == 0 && stat.disconnects != null).getArray().sort( (s1, s2) => s2.downRate - s1.downRate )
				addrs = addrs.concat( prevCon.slice(numAddrs - addrs.length) )
			}

			addrs = Array.from(new NSet(addrs))
			addrs = addrs.slice(0, numAddrs)
			self.emit('connecting_peers')
			async.each(addrs, _addPeer, (err) => { self.emit('new_peers') })

		}



	}

	acceptPeerConnCond() {

		if (this.download.seeding) {
			return Math.max(HARD_MAX_CONNECTIONS - this.peers.size, HARD_MAX_UNCHOKE - this.unchokedPeers.size)// SOFT_MIN_INTERESTED - this.aInterestedPeers.size, 0)
		} else {
			return this.connectMorePeersCond()
		}

	}

	connectMorePeersCond () {

		if(this.download.seeding)
			return 0

		return Math.max(SOFT_MIN_CONNECTIONS - this.peers.size, SOFT_MIN_UNCHOKED - this.amUnchokedPeers.size, SOFT_MIN_INTERESTED - this.aInterestedPeers.size, 0)
	
	}

	makePeer(sock, addr) {

		if(!sock) {

			let sockOpts = { 'allowHalfOpen' : false }
			sock = new net.Socket(sockOpts)
			sock.connect(addr.port, addr.host)		

		}

		let peer = new Peer(this.fileMetaData, this.download, sock, (this.checkPeerID).bind(this), new BitTorrentMsgParser(this.fileMetaData))
		this.addListeners(peer, this.listeners)

		return peer

	}

	addListeners(peer, listeners) {

		for( var event in listeners)
			for( var listener in listeners[event])
				peer.on(event, listeners[event][listener])
		
	}


	checkPeerID(peerID) {

		return Array.from(this.peers).every( peer => peer.peerID != peerID) && peerID != this.download.peerID

	}

	connectPeer (addr) {
		
		let self = this
		return new Promise((resolve, reject) => {

			let peer = this.makePeer(null, addr).handshake()
		
			peer.timeout = setTimeout(()=> {

				let stat = self.peerStats.get(addr.host + ":" + addr.port)
				if(stat) stat.online = 0
				reject(new Error("peer timeout"))

			}, this.defaultTimeout)

			peer.on('connected', (peer) => {

				clearTimeout(peer.timeout)
				resolve(peer)

			})

			peer.on('reject id', (peer) => {

				clearTimeout(peer.timeout)
				reject(new Error('rejected id'))

			})
			
		})
	}

	addPeers (addrs) {

		//if(LOG)
		//	console.log("Connecting peers:", addrs)

		if(!addrs)
			return

		addrs = addrs.filter(addrs => Array.from(this.peers).every(oPeer => oPeer.port != addrs.port && oPeer.host != addrs.host))
		
		for(var addr of addrs) {
			
			if( !this.peerStats.has(addr.host + ":" + addr.port) )
				this.peerStats.set(addr.host + ":" + addr.port, { disconnects : null, host : addr.host, port : addr.port, online : 1 , status : 0})

		}

		this.connectManager()

		if(this.peerStats.size > MAX_NUM_PEERSTATS) {
			//sort by oldest first connect - kill never connected
			//kill zero download if leeching or zero upload if seeding
			//kill slow peers
		}

	}

	piecesByFreq2 (peers) {

		peers = peers || this.peers
		let file = this.fileMetaData, peerPieceSet = []
		let myPieces = (new NSet(file.pieces.keys())).union(new NSet(file.activePieces.keys()))
 
		for( var peer of peers) {
			peerPieceSet.push(this.allPieces(new NSet([peer]), myPieces))
		}

		return byFreq2(peerPieceSet)

	}

	peersWithPiece(index, peers) {

		return peers.filter( peer => peer.pieces.has(index))

	}

	allPieces(peers, pieces) {

		peers = peers || this.peers
		pieces = pieces || new NSet()
		let allPieces = new NSet()

		for( let peer of peers ) {
			allPieces = allPieces.union(peer.pieces.difference(pieces))
		}

		return allPieces
	}


	havePiece(index) {

		this.peers.forEach( peer => peer.have(index) )
		this.peers.forEach( peer => peer.updateInterested() )		

	}

	get leechers() {

		return this.peers.filter( peer => !peer.isSeeder() )

	}

	get seeders() {

		return this.peers.filter( peer => peer.isSeeder() )

	}

	get optimisticUnchokePeers () {

		return this.peers.filter( peer => peer.optUnchoked )

	}

	get unchokedPeers () {

		return this.peers.filter( peer => !peer.choked)

	}

	get chokedPeers () {

		return this.peers.difference(this.unchokedPeers)

	}

	get amUnchokedPeers () {

		return this.peers.filter( peer => !peer.pChoked)

	}

	get amChokedPeers () {

		return this.peers.difference(this.amUnchokedPeers)

	}

	get interestedPeers () {

		return this.peers.filter( peer => peer.interested)

	}

	get aInterestedPeers () {

		return this.peers.filter(peer => peer.aInterested)

	}

	get unInterestedPeers () {

		return this.peers.difference(this.interestedPeers)

	}
	 
	get amInterestedPeers () {

		return this.peers.filter( peer => peer.pInterested)

	}

	get amUnInterestedPeers () {

		return this.peers.difference(this.amInterestedPeers)

	}

	get metaInfoExPeers () {

		return this.peers.filter( peer => peer.supportedExtensions['ut_metadata'])

	}

}

/*
  1 (error)
#    2 (checked)
#    3 (paused)
#    4 (super seeding)
#    5 (seeding)
#    6 (downloading)
#    7 (super seeding (forced))
#    8 (seeding (forced))
#    9 (downloading (forced))
#    10 (queued seed)
#    11 (finished)
#    12 (queued)
#   13 stop
*/

function Downloader(myPort, peerID, dht, log) { //extends eventEmitter

	LOG = log 
	EventEmitter.call(this)

	this.myIP = ""
	this.myPort = myPort //listen port for new peers
	this.peerID = Buffer.concat( [Buffer.from('-fz1000-', 'ascii'), crypto.randomBytes(12)] ).toString('hex')

	this.uLoop = null
	this.optLoop = null
	this.sLoop = null
	this.annLoop = null

	this.announceUrlList = []
	this.trackers = {}

	this.trackerless = false
	this.dht = dht
	this.dhtPort = DHT_PORT
	this.enableDHT = ENABLE_DHT
	this.setDHTListener = false

	this.activePieces = new NMap()
	this.pieces = new Map()
	this.seeding = null

	//this.announcing = null

	this.STATES = { 'seeding' : 0, 'leeching' : 1, 'uninitialized' : 2, 'initialized' : 3, 'stopped' : 4 }
	this.state = this.STATES['uninitialized']
	this.actions = {'checking_disk': false, 'reading_file' : false ,'announcing' : false, 'dht_announcing': false , 'connecting' : false, 'fetching_metadata' : false }

	this.fileMetaData = {

		'magnetURIString' : null,
		'peerID' : this.peerID, //kill
		'activePieces' : this.activePieces, //kill
		'pieces' : this.pieces, //pieces this peer has //kill
		'announceUrlList' : [], 
		'date' : "", 
		'infoHash' : null,
		'metaInfoSize' : null,
		'name' : "",
		'pathList' : [],
		'fileLength' : null, 
		'fileLengthList': [],
		'numPieces' : null,
		'pieceLength' : null,
		'pieceHashes' : [],
		'ready' : false

	}

	let self = this, file = this.fileMetaData

	//event - 0:none, 1:complete, 2:started, 3:stopped
	this.stats = {

		get downloaded() { return self.pieces.has(file.numPieces - 1) ? (file.pieces.size - 1) * file.pieceLength +  file.fileLength % file.pieceLength : file.pieces.size * file.pieceLength },
		get left() { return file.fileLength - self.stats.downloaded} ,
		get uploaded() { return 0 },
		ev : 2 //???

	}

	this.download = {

		ready : false,
		peerID : this.peerID,
		pieces : this.pieces,
		activePieces : this.activePieces,
		//seeding : this.seeding,

		get seeding() { 

			if(!self.fileMetaData.ready)
				return false

			return self.download.pieces.size >= self.fileMetaData.numPieces

		},

		stats : this.stats

	}

	this.swarm = new Swarm(this.fileMetaData, this.download, this.myIP, this.myPort)

	this.swarm.on('connecting_peers', () => { 

		if(!self.fileMetaData.metaInfoRaw)
			self.actions['fetching_metadata'] = true
		self.actions['connecting'] = true

	})

	this.swarm.on('new_peers', () => { self.actions['connecting'] = false })

	//connected/disconnected/peer_interested/peer_unchoked/peer_choked/new_pieces
	this.swarm.listeners['got_meta_data'] = [ ( async (buf) => { 

		if(this.fileMetaData.metaInfoRaw)
			return

		if(LOG)
			console.log('got metadata')

		this.fileMetaData.metaInfoRaw = buf
		this.actions['fetching_metadata'] = false

		await this.setMetaInfo(buf)

		this.fileMetaData.ready = true
		this.state = (this.download.seeding) ? this.STATES['seeding'] : this.STATES['leeching']

		if(!this.download.seeding)
			this.downloadPieces()
		else 
			this.seed() 

	}).bind(this) ]

	this.swarm.listeners['connected'].push( (peer) => { peer.requestList = [] })

	this.swarm.listeners['connected_extensions'] = [(peer) => { 

		if(!self.fileMetaData.metaInfoRaw)
			peer.init() 

	}]

	this.swarm.listeners['peer_choked'].push( (peer) => {  

		peer.requestList.forEach( req => {

			clearTimeout(req.timeout)
			req.putBack()

		})

		peer.requestList = []

	})

	this.swarm.listeners['peer_request'] = [async (peer, index, begin, length) => {  //fulfill all requests from unchoked peers

			if(LOG) {
				console.log('peer_request', index)
				console.log(peer)
			}

			let piece = self.download.pieces.get(index)
			let buf = await piece.readPiecelet(begin, length)

			if(LOG) {
				console.log('fulfilling req')
				console.log(peer)
			}

			peer.piece(index, begin, buf)

	}]	

	this.swarm.listeners['peer_piece'] = [async (peer, index, begin, piecelet) => { 

		if(!self.activePieces.has(index))
			return
		
		let aPiece = self.activePieces.get(index)
		//if(LOG)
		//	console.log('peer_piece', index, aPiece.requestList.size, aPiece.dispatchList.size, aPiece.piecelets.size, self.download.pieces.size, self.fileMetaData.numPieces)

		let pos = peer.requestList.findIndex( req => req.index == index && req.begin == begin && req.length == piecelet.length)
		
		if(pos != -1)
			peer.requestList.splice(pos, 1)
		
		let piece = self.activePieces.get(index)
		await piece.add(index, begin, piecelet)
		//piece.add(index, begin, piecelet)

		if(piece.isComplete) {

			//if(LOG)
			//	console.log('isComplete')

			let success =  await piece.assemble()

			if(success) {
				
				//if(LOG)
				//	console.log('written to disk')

				self.activePieces.delete(index)
				self.pieces.set(index, new self.Piece(index))
				self.swarm.havePiece(index)
								
				if(self.pieces.size == self.fileMetaData.numPieces) { //if self.download.seeding
					
					self.seeding = true
					self.state = self.STATES['seeding']
					// should close write file descriptor
					///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
					//self.fileMetaData.files.forEach( (file) => file.end( () => { if(LOG) console.log('closing file descriptors') }) )
					self.seed()	
					return	
				} 

			}

			self.emit('recieved_piece')  //??

		} 

		self.emit('recieved_piecelet')
				
	}]

}

util.inherits(Downloader, EventEmitter)

Downloader.prototype.setMetaInfoFile = async function (metaInfoFilePath) {

	this.actions['reading_file'] = true

	try {

		if(!fs.existsSync(metaInfoFilePath))
			throw new Error("File not found")

		let fileMetaData = this.fileMetaData
		let metaData = fs.readFileSync(metaInfoFilePath)
		let deMetaData = benDecode(metaData)
		let {announce, info} = deMetaData

		let announceList = deMetaData['announce-list']
		this.trackerless = ! (announceList || announce)
		
		if(!this.trackerless) {

			this.fileMetaData.announceUrlList = Array.isArray(announce) ? announce.map( url => url.toString()) : [announce.toString()]
			if(announceList)
				this.fileMetaData.announceUrlList = this.fileMetaData.announceUrlList.concat( announceList.map( url => url[0].toString()) )

		}
		
		fileMetaData.metaInfoRaw = info

		await this.setMetaInfo(benEncode(info))

		fileMetaData.ready = true
		this.state = this.STATES['initialized']
		

	} catch( error ) {

		throw error

	} finally {

		this.actions['reading_file'] = false

	}
	
}

Downloader.prototype.setMagnetUri = function(magnetUri) {

	if(magnetUri.slice(0, 8) != "magnet:?")
		throw new Error("Invalid magnetURI")

	let {xt, dn, tr} = querystring.parse(magnetUri.slice(8))

	if(!xt)
		throw new Error("Invalid magnetUri")
	
	let file = this.fileMetaData
	file.magnetURIString = magnetUri
	file.infoHash = Buffer.from(xt.slice(9), 'hex')
	file.name = dn
	file.announceUrlList = Array.isArray(tr) ? tr : [tr]
	this.trackerless = !tr //need to get metaData
	this.state = this.STATES['initialized']

}

Downloader.prototype.setMetaInfo = async function (info) {

	this.actions['checking_disk'] = true
	let fileMetaData = this.fileMetaData

	fileMetaData.metaInfoSize = info.length
	fileMetaData.infoHash = new Buffer(crypto.createHash('sha1').update(info).digest('hex'), 'hex')
	//fileMetaData.date = ['creation date']

	let m = benDecode(info)
	fileMetaData.name = m.name.toString()
	fileMetaData.pieceLength = m['piece length']
	fileMetaData.pieceHashes = m.pieces.toString('hex').match(/.{40}/g)

	createDirectory(DOWNLOAD_DIRECTORY + "/" + fileMetaData.name)

	if(m.length) {

		fileMetaData.isDirectory = false
		fileMetaData.fileLength = m.length
		fileMetaData.fileLengthList = [fileMetaData.fileLength]
		fileMetaData.path = "./" + fileMetaData.name + "/" + fileMetaData.name
		fileMetaData.pathList = [ fileMetaData.path ]
		if(LOG)
			console.log('pathList', fileMetaData.pathList)

	} else { 

		fileMetaData.isDirectory = true
		fileMetaData.fileLengthList = m.files.map( pair => pair.length )
		fileMetaData.fileLength = fileMetaData.fileLengthList.reduce( (sum, b) => sum + b, 0)
		fileMetaData.pathList = m.files.map( pair => pair.path ).map( name => DOWNLOAD_DIRECTORY + "/" + fileMetaData.name + "/" + name)

		if(LOG) {
			console.log(fileMetaData.fileLength)
			console.log(fileMetaData.fileLengthList)
			console.log(fileMetaData.pathList)
			console.log(fileMetaData.pieceLength)
		}

	}

	fileMetaData.files = fileMetaData.pathList.map( path => randomAccessFile(path) )
	fileMetaData.numPieces = Math.ceil( fileMetaData.fileLength / fileMetaData.pieceLength) 

	this.Piece = Pieces(fileMetaData)
	this.ActivePiece = ActivePieces(fileMetaData)

	for(let idx = 0; idx < fileMetaData.numPieces; idx ++ ) {

		let piece = new this.Piece(idx)
		if(await piece.verify()) {
			this.pieces.set(idx, piece)
		}

	}

	if(LOG)
		console.log('Have', Math.floor(this.pieces.size / this.fileMetaData.numPieces * 100), "% of pieces.")

	this.seeding = this.pieces.size == fileMetaData.numPieces

	//if(this.download.seeding)
	//	this.state = this.STATES['seeding']

	this.actions['checking_disk'] = false

	return this.seeding

}

Downloader.prototype.getMetaData = function() {

}

//only call when initialized or stopped
Downloader.prototype.start = async function(override) {

	if( (this.state == this.STATES['seeding'] || this.state == this.STATES['leeching'] || this.state == this.STATES['uninitialized']) && !override )
		return

	this.swarm.startTime = Date.now()	

	if (this.download.seeding) //default false - set by setMetaInfoFile 
		this.seed()
	else
		this.leech()

	this.state = this.download.seeding ? this.STATES['seeding'] : this.STATES['leeching'] //kill

}

//only call when leeching or seeding
Downloader.prototype.stop = function() {

	//seeding or downloading
	if(this.state == this.STATES['uninitialized'] || this.state == this.STATES['initialized'] || this.state == this.STATES['stopped']) 
		return

	clearInterval(this.announceLoop)
	clearInterval(this.sLoop)
	clearInterval(this.optLoop)
	clearInterval(this.unchokeLoop)
	this.optLoop = null

	this.swarm.stop()

	let peers = this.swarm.peers
	this.swarm.peers.forEach( peer => peer.sock.end())

	this.swarm.peers.clear()
	this.activePieces.clear()

	this.trackers = {}

	this.state = this.STATES['stopped']

}

Downloader.prototype.leech = function() {

	this.swarm.start()

	clearInterval(this.sLoop)
	this.announceLoop()
	this.annLoop = setInterval((this.announceLoop).bind(this), ANNOUNCE_LOOP_INTERVAL )

	let self = this 

	var updateActivePieces = () => {
	
		let peers = self.swarm.amUnchokedPeers.intersection(self.swarm.aInterestedPeers) //if small then add peers from aInterested
		if(peers.size == 0) 
			peers = self.swarm.aInterestedPeers 

		for(index of self.activePieces.keys()) {
			if(self.swarm.peersWithPiece(index, peers).size == 0) 
				self.activePieces.delete(index)
		}

	}	

	this.swarm.on('peer_disconnected', updateActivePieces )	
	this.swarm.on('peer_choked', updateActivePieces )

	this.swarm.on('peer_interested', (this.optUnchokeLoop).bind(this))
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), OPT_LOOP_INTERVAL)
	this.swarm.on('peer_interested', (this.unchokeLoop).bind(this))
	this.swarm.on('peer_unchoked', (this.unchokeLoop).bind(this))
	this.uLoop = setInterval((this.unchokeLoop).bind(this), UNCHOKE_LOOP_INTERVAL)

	this.on('recieved_piece', (this.downloadPieces).bind(this))
	this.on('recieved_piecelet', (this.downloadPiecelets).bind(this))
	this.on('request_timeout', (this.downloadPieces).bind(this))
	this.on('request_timeout', (this.downloadPiecelets).bind(this))

	this.swarm.on('new_pieces', (this.downloadPieces).bind(this)) //aInterested
	this.swarm.on('peer_unchoked', (this.downloadPieces).bind(this)) //amUnChoked

}

Downloader.prototype.seed = function () {

	this.swarm.start()

	clearInterval(this.uLoop)
	//disconnect seeders

	this.announceLoop()
	this.annLoop = setInterval((this.announceLoop).bind(this), ANNOUNCE_LOOP_INTERVAL) 

	this.on('new_peers', (this.optUnchokeLoop).bind(this))
	this.optLoop = setInterval((this.optUnchokeLoop).bind(this), OPT_LOOP_INTERVAL)

	this.on('new_peers', (this.seedLoop).bind(this))
	this.sLoop = setInterval((this.seedLoop).bind(this), SEED_LOOP_INTERVAL)

	//connectLoop prunes connections if seeding
}

Downloader.prototype.announceLoop = function() {
	
	if(this.enableDHT || this.trackerless)
		this.DHTAnnounce()	
	
	if(!this.trackerless)
		this.announce()

}

Downloader.prototype.seedLoop = function() {

		this.swarm.seeding = true

		let swarm = this.swarm
		let peerMap = this.swarm.peerStats

		swarm.leechers.intersection(swarm.amUnInterestedPeers).intersection(swarm.unchokedPeers).forEach( peer => peer.choke() ) //uninterested peers who are unchoked

		let interestedPeers = swarm.leechers.intersection(swarm.amInterestedPeers)

		let unchokeCandidates = Array.from(interestedPeers).sort( (p1, p2) => {

			let p1Stats = peerMap.get(p1.peerID), p2Stats = peerMap.get(p2.peerID)
			return p1Stats.upRate - p2Stats.upRate

		})

		for(let numUnchoked = 0; numUnchoked < MAX_NUM_MUTUAL_UNCHOKE && unchokeCandidates.length > 0; numUnchoked++) { //maybe add randomness ??

			candidate = unchokeCandidates.shift()

			if(candidate.choked)
				candidate.unchoke()

		}

		let self = this
		unchokeCandidates.filter(peer => !peer.choked).forEach( peer => peer.choke())

}

Downloader.prototype.optUnchokeLoop = function() {

		let swarm = this.swarm, peerMap = this.swarm.peerStats
		let interestedAndChoked = swarm.leechers.intersection(swarm.interestedPeers).intersection(swarm.chokedPeers)

		swarm.optimisticUnchokePeers.forEach( peer => { peer.choke() ; peer.optUnchoked = false}  )
	
		let unchokeCandidates = Array.from(interestedAndChoked).sort( (p1, p2) => (peerMap.get(p2.peerID).firstConnect) - (peerMap.get(p1.peerID).firstConnect ) )
		
		for(let numUnchoked = 0; numUnchoked < MAX_NUM_OPT_UNCHOKE && unchokeCandidates.length > 0; numUnchoked++) { //maybe add randomness ??

			let randIdx = Math.floor(Math.random() ** 2 * unchokeCandidates.length)
			let candidate = unchokeCandidates.splice(randIdx, 1)[0]
			candidate.unchoke()
			candidate.optUnchoked = true

		}

}

Downloader.prototype.unchokeLoop = function() {

	let swarm = this.swarm

	//choke any peer that chokes me and is not opt unchoke
	let peers = swarm.leechers.difference(swarm.optimisticUnchokePeers)
	peers.intersection(swarm.unchokedPeers).intersection(swarm.amChokedPeers).forEach( peer => peer.choke() )

	let self = this
	
	//mutually interested peers -- initially near zero --- must add group (3) peers when sending requests
	let mutuallyInterestedPeers = swarm.leechers.intersection(swarm.interestedPeers).intersection(swarm.amInterestedPeers).difference(swarm.optimisticUnchokePeers)

	let amUnchoked = mutuallyInterestedPeers.intersection(swarm.amUnchokedPeers)

	let peerMap = this.swarm.peerStats
	let unchokeCandidates = Array.from(amUnchoked).sort( (p1, p2) =>  peerMap.get(p1.peerID).downRate - peerMap.get(p2.peerID).downRate )

	let numUnchoked = 0 
	while(numUnchoked < 8 && unchokeCandidates.length > 0) { //MAX_NUM_MUTUAL_UNCHOKE

		candidate = unchokeCandidates.shift()
		if(candidate.choke)
			candidate.unchoke()
		numUnchoked++

	}

	if(LOG)
		console.log('UnchokeLoop: unchoking', numUnchoked)

	unchokeCandidates.filter(peer => !peer.choked).forEach( peer => peer.choke())

	if(numUnchoked < 8) { // 
		//unchoke more candidates
		//so 8 mutually unchoked and 2 opt unchoked
		//if 8 - k mutually unchoked then 2 + k opt unchoked ??
	}

	//download from amUnchoked peers - includes peers unchoked here 
	//plus group peers that have chosen me as opt unchoke (amOpt) - group (3) plus some group (1) peers

}

Downloader.prototype.downloadPieces = function() {

	if(!this.fileMetaData.ready) //no requests unless have metaInfo
		return

	var maxActivePieces = () => {
		//this.pieces.size + this.activePieces.size < this.fileMetaData.numPieces
		let left = this.fileMetaData.numPieces - this.pieces.size 
		return left >= NUM_ACTIVE_PIECES ? NUM_ACTIVE_PIECES : left

	}

	peers = this.swarm.amUnchokedPeers.intersection(this.swarm.aInterestedPeers)

	if( !(this.activePieces.size < maxActivePieces()))
		return this.downloadPiecelets()

	if(this.swarm.amUnchokedPeers.size == 0 && this.activePieces.size == 0)
		peers = this.swarm.aInterestedPeers

	/////////////////
	hist = this.swarm.piecesByFreq2(peers).map( tuple => tuple[0] )
	hist = hist.filter( x => x || (x == 0))
	hist = hist.filter(x => x < this.fileMetaData.numPieces)
	///////////////

	while( this.activePieces.size < maxActivePieces() && hist.length > 0 && this.activePieces.size < hist.length &&  this.pieces.size < this.fileMetaData.numPieces ) {

		let randArrIdx = Math.floor(Math.pow(Math.random(), 3) * hist.length)
		let pIndex = hist[randArrIdx]
		this.activePieces.set(Number(pIndex), new this.ActivePiece(Number(pIndex)))
		this.swarm.peers.forEach( peer => peer.updateInterested() )
	}

	this.downloadPiecelets()
	//download pieces from mutually unchoked peers in group (1) and amUnchoked peers in group (3)

}

Downloader.prototype.randReqToPeer = function(peer) {

	if(!peer)
		return null

	let pieceletReq, randomIndex, piece
	let pieces = peer.pieces.intersection(new NSet(this.activePieces.keys()))

	if(pieces.size == 0)
		return null

	let pieceList = Array.from(pieces)

	do { //randomly select piece, get piecelet or if no piecelet then repeat
		//console.log('getting piecelet')
		randomIndex = Math.floor(Math.random() * pieceList.length) //maybe favour pieces that idle peers have ??
		piece = Array.from(pieces)[randomIndex]
		pieceletReq = this.activePieces.get(piece).randPieceletReq(peer)

		if(!pieceletReq)
			pieceList.splice(randomIndex, 1)

	} while (!pieceletReq && pieceList.length > 0) 

	if(pieceletReq) {
		peer.requestList.push(pieceletReq)
		peer.request(pieceletReq)
	}

	return pieceletReq

}

Downloader.prototype.downloadPiecelets = function() { 

	let swarm = this.swarm, peers = swarm.amUnchokedPeers.intersection(swarm.interestedPeers)

	if(peers.size == 0) 
		return

	while(this.activePieces.getArray().map(piece => piece.requestsLeft()).reduce((sum, numReqs) => sum + numReqs, 0) > 0  && peers.size > 0 && this.activePieces.size > 0 ) {

		let rand = Math.random()
		let randPeer = Array.from(peers)[Math.floor(rand) * peers.size]	

		if( randPeer.requestList.length > NUM_REQUESTS_PER_PEER || !this.randReqToPeer(randPeer) ) //no more piecelets or more than 4 req
			peers.delete(randPeer) 

	}

}

Downloader.prototype.addPeers = function(peers) {

	//if(LOG)
	//	console.log("downloader addPeers")

	peers = peers.map( (tuple) => { return { host : tuple.ip, port : tuple.port } } )
	this.swarm.addPeers(peers)

}

Downloader.prototype.DHTAnnounce = async function() {

	if(!this.dht && !INITIALIZE_DHT)
		return

	if(!this.dht) {

		this.dht = new DHT(this.dhtPort, "")

		if(fs.existsSync("./savedDHT"))
			await this.dht.loadDHT()
		else
			this.dht.bootstrap() 

	} else if(this.dht.buckets.length <= 1) {

		await this.dht.bootstrap()

	}

	let self = this

	if(!this.setDHTListener) 
		this.dht.on('got_peers', ( peers ) => { self.addPeers(peers) } )

	let peerList = await this.dht.announce(this.fileMetaData.infoHash, this.myPort)

	//if(LOG)
	//	console.log(peerList)

	this.addPeers(peerList)

}

Downloader.prototype.announce = async function() {
	
	//this.announcing = true
	this.actions['announcing'] = true
	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID
	
	var _annnounce = (async function (announceUrl, callback) {
		
		let u = new url.URL(announceUrl)
		let resp, tracker = this.trackers[u.href]


		try {

			if(LOG)
				console.log("Announcing:", u.protocol, u.href)

			if(!tracker) {

				if(u.protocol == 'udp:')
					tracker = new UDPTracker(u, infoHash, Buffer.from(peerID,'hex'), this.download.stats)
					
				else if (u.protocol == 'http:') 
					tracker = new HTTPTracker(this.fileMetaData, this.download, u)

				this.trackers[u.href] = tracker

			}

			resp = await tracker.doAnnounce(this.myPort)
			let { numLeechers, numSeeders, interval, peerList } = resp

			peerList = peerList || []

			//if peerList.length == 0 then callback(error) eles callback(null, peerList)
			this.addPeers(peerList)
			callback()

			if(LOG) {
				console.log("Tracker:", announceUrl)
				console.log("leechers:", numLeechers)
				console.log('seeders:', numSeeders)
				console.log('peers returned:', peerList.length)
			}

		} catch(error) {

			if(LOG)
				console.log(error)
			callback()
			//callback(error)

		} 

	}).bind(this)

	let self = this

	//async.tryEach
	async.each( this.fileMetaData.announceUrlList, _annnounce, function (err) {

		if(LOG && err)
			console.log(err)
		//self.announcing = false
		self.actions['announcing'] = false


	})

}

module.exports = {

	Downloader : Downloader,
	Swarm : Swarm

}