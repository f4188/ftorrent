
net = require('net')

benDecode = require('bencode').decode 
benEncode = require('bencode').encode

const UDPTracker = require('../tracker/index.js').UDPTracker

//constants
//outstanding requests per peer
//number of outstanding requests
//number of active pieces
const NUM_REQUESTS_PER_PEER = 5
const NUM_OUTSTANDING_REQS = 200
const NUM_ACTIVE_PIECES = 12
const NUM_CONNECTIONS = 50

// peer requests = [{peer, ... }, ... ]
// peer pieces = [ { - , pieceIndex}, ... ]

var reqFreq = (arr, prop) => {

	let freqs = arr.reduce( (freqs, elem) => {
		if(freqs[elem[prop]]) {
			freqs[elem[prop]] ++
		} else {
			freqs[elem[peer]] = 1
		}
	}, {})

	Object.keys(freqs).forEach(key => {
		freqs[key] /= arr.length
	})

	let freqArray = []

	let keys = Object.keys(freq)

	for(key in keys) {
		freqArray.push({key : key, freq : freq[key]})
	}

	freqArray.sort( (kv1, kv2) => kv1.freq > kv2.freq ) //sort by smallest

	return freqArray //remove freq

}

//currently connected peers
class Swarm { //ip list

	constructor(fileMetaData) {

		this.peerIDs = new Map()
		this.peers = []
		this.optPeers = []
		
		this.fileMetaData = fileMetaData

		this.connecting = []
		this.disconnected = []

		this.listeners = {}

		var sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

		//this.UTPserver = uTP.createServer() // ...

		this.TCPserver = net.createServer(sockOpts, ( sock ) => {

			let peer = new Peer(this.fileMetaData, this.listeners, sock) //peer owns socket

			self = this

			peer.on('connected', () => {
				self.emit('new_peer', peer)
			})

		}).listen()

		//Object.defineProperty

	}

	connectPeer (addr) {
		
		return new Promise((resolve, reject) => {

			let peer = new Peer(this.fileMetaData, this.listeners, null, addr)

			let timeout = setTimeout(()=> {
				reject("peer timeout")
			}, this.defaultTimeout)

			peer.on('connected', () => { //after recieving handshake
				clearTimeout(timeout)
				resolve(peer) 
			})
			
		} )
	}

	connectManyPeers (addrs) {
		return addrs.map( (addr) => connectPeer(addr) )
	}

	addPeers (addrs) {
		connectManyPeers.forEach( async (promise) => {
			try {
				peer = await promise
				this.peers.push(peer)
			} catch (error) {

			}
			// do something
			//if bad peer discard
			//
		})
	}

	newPeers () {

	}

	piecesByFreq (peerSet) {

		let peers  
		if(peerSet)
			peers = Array.from(peerSet) 

		peers = this.peers

		//return this.byFreq(peers)
		let have = this.fileMetaData.pieces.has
		let peerPieceList = peers.map( peer => Array.from(peer.pieces).map({ peer : peer, pieceIndex : peers.pieces } ) )
		let dontHavePieceList= peerPieceList.filter( peerPieces => !have(peerPieces.pieces) )

		return byFreq(dontHavePieceList, 'pieceIndex').map( kv => kv.key )

	}

	//set of pieces these peers have
	pieces(peers) { 
		peers = peers || NSet(this.peers)
		let pieces 
		peers.forEach( peer => pieces.union( peer.pieces ) )
		return pieces
	}

	//set of peers that have index piece
	havePiece(index, peers) {
		peers = peers || NSet(this.peers)
		return NSet(Array.from(peers).filter( peer => peer.pieces.have(index)))
	}

	//havePiece (pieceIndex) {
	//	this.peers.forEach( peer =>  peer.have(pieceIndex) )
	//}

	get leechers() {
		return new NSet(this.peers.filter(peer => !peer.isSeeder()))
	}

	get seeders() {
		return new NSet(this.peers.filter(peer => peer.isSeeder()))
	}

	get optimisticUnchokePeers () {
		return new NSet(this.optPeers)
	}

	get unChokedPeers () {
		return new NSet(this.peers.filter(peer => !peer.choke))
	}

	get chokedPeers () {
		return new NSet(this.peers).difference(this.unChokedPeers())
	}

	get amUnchokedPeers () {
		return new NSet(this.peers.filter(peer => !peer.pChoke))
	}

	get amChokedPeers () {
		return new NSet(this.peers).difference(this.amUnchokedPeers())
	}

	get idlePeers () {
		return NSet(this.peers.filter( peer => peer.idle ))
	}

	get activePeers () {
		return new NSet(this.peers).difference(this.idle())
	}

	get interestedPeers () {
		return new NSet(this.peers.filter(peer => peer.interested))
	}

	get unInterestedPeers () {
		return new NSet(this.peers).difference(this.interestedPeers())
	}
	 
	get amInterestedPeers () {
		return new NSet(this.peers.filter( peer => peer.pInterested ))
	}

	get amUnInterestedPeers () {
		return new NSet(this.peers).difference(this.amInterestedPeers())
	}

}

function Downloader() { //extends eventEmitter

	//this.pieces = new Set()
	this.peerID = crypto.randomBytes(20)
	this.port

	this.activePieces = new Set()
	this.pieces = new Map()

	this.announceUrlList = []

	this.fileMetaData = {
		'activePieces' : this.activePieces,
		'announceUrlList' : [],
		'date' : "", 
		'infoHash' : null,
		'raw' : null,
		'metaInfoSize' : 0,
		//'info' : null, //for metaDataExchange - must be buffer
		//'infoSize' : 0,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, 
		'numPieces' : null,
		'pieceHashes' : [],
		'pieces' : this.pieces //pieces this peer has
	}
	
	let file = this.fileMetaData
	

	this.stats = {

		get downloaded() { return this.pieces.has(file.numPieces - 1) ? (file.pieces.size - 1) * file.pieceLength +  file.fileLength % file.pieceLength : file.pieces.size * file.pieceLength },
		get left() { return file.fileLength - this.stats.downloaded} ,
		get uploaded() {  },
		ev : 2 //???

	}

	this.swarm = new Swarm(this.fileMetaData)	



	this.swarm.listeners = {

		'connected' : (( peer ) => {

			let peerIDs = this.swarm.peerIDs, peerID = peer.peerID

			if(!peerIDs.has(peerID)) 
				peerIDs.set(peerID, {'uploadedTime' : 0, 'uploadBytes': 0, 'disconnects' : 0})

		}).bind(this),

		'disconnected' : (( peer ) => {

			let peerStats = this.swarm.peerIDs.get(peer.peerID)
			peerStats.disconnects++

		}).bind(this),

		'peer_request' : (index, begin, length, peer) => {  //fulfill all requests from unchoked peers

			let start = index * piece_length + begin, end = index * piece_length + begin + length
			let piece = fs.createReadStream(this.path, {'start': start, 'end' : end})

			piece.on('readable', () => {
				let piece = pieceStream.read(length)
				if(piece != null) 
					peer.piece(index, begin, piece)
			})

		},

		'peer_piece' : ((index, begin, piecelet, peer, uploadTime) => { 

			let start = index * this.fileMetaData.pieceLength + begin
			let piece = this.pieces.get(index)
			piece.add(index, begin, piecelet)

			let peerStats = this.swarm.peerIDs.get(peer.peerID)
			peerStats.uploadTime += uploadTime
			peerStats.uploadBytes += piecelet.length

			this.requests = this.requests.filter( req => req.index == index && req.begin == begin && req.length == piecelet.length)

			if(piece.isComplete && piece.assemble()) { //copy to disk		

				this.activePieces.delete(piece)
				this.fileMetaData.pieces.add(index)
				this.swarm.havePiece(index)
								
				if(this.pieces.size == this.file.numPieces) {
					//done
					//begin seeding
					return
				}				

				this.pieces.set(index, null)
				this.emit('recieved_piece') //call downloadPiece before downloadPiecelet

			} 

			this.emit('recieved_piecelet')
					
		}).bind(this)

	}

}

Downloader.prototype.setupWithMetaInfoFile = function (metaInfoFilePath) {
	
	let metaInfo
	if(fs.existsSync(metaInfoFilePath))
		metaInfo = fs.readFileSync(metaInfoFilePath)
	else 
		return

	let {announce, info} = benDecode(metaInfo)

	//this.metaInfo 

	let fileMetaData = this.fileMetaData

	let m = info

	fileMetaData.infoHash = crypto.createHash('sha1').update(metaInfo).digest('hex')
	fileMetaData.metaInfoRaw = metaInfo
	fileMetaData.announceUrlList = Array.isArray(announce) ? announce.map( url => url.toString()) : [announce.toString()]
	fileMetaData.metaInfoSize = metaInfo.length
	//fileMetaData.date = ['creation date']
	fileMetaData.name = m.name.toString()
	fileMetaData.pieceLength = m['piece length']
	fileMetaData.fileLength = m.length
	fileMetaData.pieceHashes = m.pieces.toString().match(/.{8}/g) //string or buffer ???
	fileMetaData.numPieces = Math.ceil(fileMetaData.fileLength / fileMetaData.pieceLength) 

	this.path = "./" + fileMetaData.name

	if(m.length) {
		//single file
		fileMetaData.isDirectory = false

	} else if(m.files) {

		fileMetaData.isDirectory = true
		fileMetaData.fileList = m.files

	}


}

Downloader.prototype.setupWithMagnetUri = function(magnetUri) {

	//use metaDataEx to acquire info 
	//do announce and get peers
	//parse uri
	//get infohash
	
	fileMetaData.infoHash = infoHashj


}

Downloader.prototype.checkDisk = async function() {

	if(!this.fileMetaData.isDirectory) {
		return await this.checkFile(this.path, 0)
	}

}

Downloader.prototype.checkFile = async function(path, offSet) {

	//let path  this.fileMetaData.name
	let size
	let pieceLength = this.fileMetaData.pieceLength

	if(fs.existsSync(path))
		size = await getFileStats(path)
	
	var readStreamFunc = async (pieceStream) => {

		return new Promise( (resolve, reject) => {

			pieceStream.on('readable', () => { 
				let data = pieceStream.read(pieceLength)  
				if(data)
					resolve(data) 
			})

		})

	}

	let pieces = this.pieces// new Set()
	let haveNumPieces = Math.floor(size / pieceLength)

	let start = 0, end = pieceLength
	let buf
	let pieceIndex = 0
	
	while(pieceIndex < haveNumPieces) {

		let pieceStream = fs.createReadStream(path, {start : start , end : end})
		
		buf = await readStreamFunc(pieceStream)

		let hash = crypto.createHash('sha1').update(buf).digest('hex')
		if(hash == this.fileMetaData.pieceHashes[pieceIndex + 0])
			pieces.set(pieceIndex, null)

		pieceIndex++
		start += pieceLength
		end += pieceLength

	}

	return this.pieces.size == this.fileMetaData.numPieces 

}

Downloader.prototype.getFileStats = function (path) {

	return new Promise( (resolve, reject) => {
		fs.stat(path, (stats) => resolve(stats))
	})

}

//start or resume download or seed
Downloader.prototype.start = async function() {

	//read torrent file or parse magnet link
	
	//on startup check disk
	//if file complete, verify, then seed
	//if file incomplete, verify pieces, begin leeching
	this.seed = await this.checkDisk(this.path, 0)  //discard corrupt pieces

	console.log('Checked disk. Have file:', this.seed)
	let peers
	let resps 
	//setup swarm
	if(!this.fileMetaData.announceUrlList) { //dht announce

		//peers = dht.announce(this.fileMetaData.infoHash)
		this.DHTAnnounce()
		
	} else { 
		
		//while(!peers) {
			console.log('announcing')
			resps = this.urlAnnounce()
			
			peers = await Promise.all(resps)


			peers = peers[0].peerList
		//}
	} 

	if(!peers) {
		//oh shit
	}

	this.swarm.connectPeers(peers)

	var unchokeLoop = () => {

		/* 
		
		:::: for leechers ::::

		(1) only mutually interested 
		unamchoked --- unchoked - (if active do nothing - if idle) unchoke by upload -- should be 8
		unamchoked --- choked - unchoke by upload            --have unchoked me - maybe have chosen me as opt unchoke (amOpt)
		amchoked ----- unchoked - choke                      --have choked me  -- maybe choose as opt unchoke if new (opt)
		amchoked ----- choke - do nothing                    -- not interested
		 

		(2) amUnInterested - interested  ------- select as opt unchoke (opt)
			amchoked -- choked

		(3) amInterested - unInterested  ------- might select me as opt unchoke (amOpt)
			amchoked -- choked
			
		(4) mutually uninterested     - have same pieces or no pieces or both seeders
			amchoked -- choked
		*/

		//blacklist peers that do not answer requests ?
		let swarm = this.swarm

		//choke any peer that chokes me and is not opt unchoke
		let peers = swarm.leechers.difference(swarm.optimisticUnchokePeers)
		let unChoked = peers.intersection(swarm.unChokedPeers)
		unChoke.intersection(swarm.amChokedPeers).forEach( peer => peer.choke())
		
		//mutually interested peers -- initially near zero --- must add group (3) peers when sending requests
		let mutuallyInterestedPeers = swarm.leechers.intersection(swarm.interestedPeers).intersection(swarm.amInterestedPeers).difference(swarm.optimisticUnchokePeers)

		let amUnchoked = mutuallyInterestedPeers.intersection(swarm.amUnchokedPeers)
	
		let peerMap = this.swarm.peerIDs
		let unchokeCandidates = Array.from(amUnchoked).sort( (p1, p2) => {

			let p1Stats = peerMap.get(p1), p2Stats = peerMap.get(p2)

			return (p1Stats.uploadBytes/p1Stats.uploadTime) < (p2Stats.uploadBytes/ p2Stats.uploadTime)

		})

		//chose best and unchoke
		let numUnchoked = amUnchoked.size
		while(numUnchoked < 8 || unchokeCandidates.size > 0) {

			candidate = unchokeCandidates.shift()
			if(candidate.choke) //if already unchoked do nothing
				candidate.unchoke()
			numUnchoked++

		}

		//choke rest of candidates
		unchokeCandidates.filter(peer => !peer.choke).forEach( peer => peer.choke())

		if(numUnchoked < 8) { // 
			//maybe optimistically unchoke more candidates
			//so 8 mutually unchoked and 2 opt unchoked
			//if 8 - k mutually unchoked then 2 + k opt unchoked ??
		}

		//download from amUnchoked peers - includes peers unchoked here 
		//plus group peers that have chosen me as opt unchoke (amOpt) - group (3) plus some group (1) peers
		
		//add new connections
		//get peers from dht ?
		//peerex

		//prune connections

	}

	var optUnchokeLoop = () => {

		//pick opts unchoke -- 4
		this.optimisticUnchokePeers

	}

	//piece downloader - only called when pieces available
	var downloadPiece = () => {

		peers = this.swarm.amUnchokedPeers.intersection(this.swarm.amInterestedPeers)
		//get resend requests sent to peers that are now choked

		this.hist = this.swarm.piecesByFreq(peers) //assume peers are representative
		//random from most freq and least freq
		//update interested peers
		while( this.activePieces < 10 || this.pieces.size < this.file.numPieces) {
			let pIndex = this.hist(Math.floor(Math.pow(Math.random(), 3)))
			if(!this.pieces.has(pIndex)) 
				this.activePieces.add(new Piece(pIndex))
		}

		//download pieces from mutually unchoked peers in group (1) and amUnchoked peers in group (3)
		//swarm.amUnchokedPeers

	}

	var	downloadPiecelets = () => {

		let swarm = this.swarm, requests = this.requests, peers = swarm.amUnchokedPeers.intersection(swarm.amInterestedPeers)
		
		this.requests.filter( request => request.peer.pChoke ).map( req => clearTimeout(req.timeout) )
		this.requests.filter( request => request.peer.pChoke || request.timeout._called ).forEach( req => req.putBack(req) )

		this.requests = this.requests.filter( request => !request.peer.pChoke && !request.timeout_called )

		var reqToPeer = (( peer, req ) => {

			req.timeout = setTimeout(()=>{ this.emit('request_timeout') }, 30 * 1e3)
			this.requests.push(req)

			peer.request(start, begin, length)

		}).bind(this)

		var randReqToPeer = ((peer) => {

			let pieceletReq, randomIndex, piece
			let iters = 0

			let pieces = peer.pieces.intersection(this.activePieces) //swarm.pieces(peers)

			do { //randomly select piece, get piecelet or if no piecelet then repeat

				randomIndex = Math.floor(Math.random() * pieces.size) //maybe favour pieces that idle peers have ??
				piece = Array.from(pieces)[randomIndex]

				pieceletReq = piece.randPieceletReq()
				iters++

			} while (!pieceletReq && iters < this.activePieces.size) //fix infinite loop

			if(iters < this.activePieces.size) //no more piecelets left
				reqToPeer( peer, pieceletReq )

			return iters < this.activePieces.size

		}).bind(this)

		//always interested in these peers
		while(this.requests.length < peers.size * 4 && peers.size > 0) {
	
			//randomly select peer - more heavily weight idle peers
			let freqArr = reqFreq(this.requests, 'peer')
			//remove peers with more than x reqs outstanding
			freqArr = freqArray.filter( req => req.freq > 8 / this.requests.length )
			
			let rand = Math.random()
			let randomPeer = Array.from(peers)[Math.floor(rand * rand * peers.size)]	


			if( randReqToPeer(randomPeer) ) //no more piecelets
				peers = peers.difference(NSet(randomPeer))

		}

		//enough outstanding requests or no piecelets for active pieces ...

	}

	this.on('recieved_piece', downloadPiece)
	this.on('recieved_piecelet', downloadPiecelets)
	this.on('request_timeout', downloadPiecelets)

	unchokeLoop()
	this.downLoop = setInterval(unchokeLoop, 10 * 1e3)

	optUnchokeLoop()
	this.optLoop = setInterval(optUnchokeLoop, 30 * 1e3)

	downloadPiece()
	downloadPiecelets()

}

Downloader.prototype.DHTAnnounce = async function() {

}

//infoHash, peerID, downloaded, left, uploaded, ev, IPAddress, key, numWant, port
//transactID, infoHash, peerID, stats, ip, key, numWant, port
Downloader.prototype.urlAnnounce = async function() {
	//stats = {downloaded, left, uploaded, ev}
	
	 //tracker announce)
	 let sock = await this.getUDPSocket()

	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID

	return this.fileMetaData.announceUrlList.map( async (announceUrl) => {		

		if(announceUrl.slice(0,6) == 'udp://') { //udp tracker			
			let tracker = new UDPTracker(sock, announceUrl, infoHash, peerID)
			//console.log(tracker)

			try {
				return await tracker.doAnnounce(this.stats, myIP) 
			} catch (error) {
				console.log(error.err)
			}

			return 

		} else if (announceUrl.slice(0,7) == 'http://') {
			let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats)
		}
	})



}

Downloader.prototype.getUDPSocket = function(port) {

	let sock = dgram.createSocket('udp4').bind()

	return new Promise ( (resolve, reject) => {
		
		sock.on('listening', () => { resolve(sock) } )

	})

}


module.exports = {
	'Swarm' : Swarm,
	'Downloader' : Downloader
}

