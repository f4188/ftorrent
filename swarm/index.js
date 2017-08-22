
module.exports = {
	'Swarm' : Swarm,
	'Downloader' : Downloader
}

net = require('net')

//currently connected peers
class Swarm { //ip list

	constructor(fileMetaData) {

		this.peers = []
		this.optPeers = []
		
		this.fileMetaData = fileMetaData

		this.connecting = []
		this.disconnected = []

		this.listeners = {}

		this.sockOpts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}

		this.UTPserver = uTP.createServer() // ...

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

		let freq = {}

		peers.reduce((peer, freq) => {
			peer.pieces.forEach(piece => {
				//if have piece skip
				if(this.fileMetaData.pieces.has(piece))
					return
				if(freq[piece])
					freq[piece]++
				else 
					freq[piece] = 1
			})
			return freq
		}, freq)

		Object.keys(freq).forEach(key => {
			freq[key] /= peers.length
		})

		//return freq
		let freqArray

		let keys = Object.keys(freq)
		keys.sort()
		for(key in keys) {
			freqArray.push(index)
		}

		return  freqArray

	}

	//set of pieces these peers have
	pieces(peers) { 
		peers = peers || NSet(this.peers)
		let pieces 
		peers.forEach( peer => pieces.union( peer.pieces ) )
		return pieces
	}

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

	this.pieces = new Set()
	this.peerID 
	this.port

	this.announceUrlList = []

	this.fileMetaData = {
		'announceUrlList' : [],
		'date' : "", 
		'infoHash' : null,
		'info' : null, //for metaDataExchange - must be buffer
		'infoSize' : 0,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, 
		'numPieces' : null,
		'pieceHashes' : [],
		'pieces' : this.pieces //pieces this peer has
	}
	
	let file = this.fileMetaData
	this.pieces = new Map()

	this.stats = {
		get downloaded() { return this.pieces.has(file.numPieces - 1) ? (file.pieces.size - 1) * file.pieceLength +  file.fileLength % file.pieceLength : file.pieces.size * file.pieceLength },
		get left() { return file.fileLength - this.stats.downloaded} ,
		get uploaded() {  },
		'ev': null //???
	}

	this.swarm = new Swarm(this.fileMetaData)	

	this.swarm.listeners = {

		'peer_request' : (index, begin, length, peer) => {  //fulfill requests when they come in
			let start = index * piece_length + begin
			let end = index * piece_length + begin + length
			let piece = fs.createReadStream(this.path, {'start': start, 'end' : end})
			piece.on('readable', () => {
				let piece = pieceStream.read(length)
				if(piece != null) 
					peer.piece(index, begin, piece)
			})
		},

		'peer_piece' : (index, begin, piecelet) => { 
			let start = index * this.fileMetaData.pieceLength + begin
			//fs.createWriteStream(this.path, {'start': start, 'mode':'r+'}).end(piece)
			let piece = this.pieces.get(index)
			piece.add(index, begin, piecelet)
			if(piece.isComplete) {
				piece.assemble()
				this.fileMetaData.pieces.add(index)
				this.swarm.havePiece(index)
				this.emit('recieved_piece')
			}

			this.emit('recieved_piecelet')
			
			//this.pieces.push(index)
		
		} 

	}

}

Downloader.prototype.setupWithMetaInfoFile = function (metaInfoFilePath) {
	
	let metaInfo
	if(fs.existsSync(metaInfoFilePath))
		metaInfo = benDecode(fs.readFileSync(metaInfoFilePath))
	else 
		return

	let {announceUrlList, date, info} = metaInfo

	this.metaInfo 

	let fileMetaData = this.fileMetaData

	let m = info

	fileMetaData.announceUrlList = announceUrlList
	//fileMetaData.metaDataSize = null
	fileMetaData.date = date
	fileMetaData.name = m.name
	fileMetaData.pieceLength = m.piece_length
	fileMetaData.fileLength = m.length
	fileMetaData.pieceHashes = m.pieces.toString().match(/.{8}/) //string or buffer ???

}

Downloader.prototype.setupWithMagnetUri = function(magnetUri) {

	//use metaDataEx to acquire info 
	//do announce and get peers


}

Downloader.prototype.checkDisk = function() {

	let path  this.fileMetaData.name

	if(fs.existsSync(path)) {
		metaInfo = benDecode(fs.readFileSync(path))
	} 

}

//start or resume download or seed
Downloader.prototype.start = function() {
	//read torrent file or parse magnet link
	


	//on startup check disk
	//if file complete, verify, then seed
	//if file incomplete, verify pieces, begin leeching
	this.seed = this.checkDisk()  //discard corrupt pieces

	//announce to trackers
	//get peer lists
	 //no peers
	//this.peerLists = this.announce().map( x => x.peerList ) 
	
	let peers
	let resps 
	//setup swarm
	if(!this.fileMetaData.announceUrlList) { //dht announce

		peers = dht.announce(this.fileMetaData.infoHash)
		
	} else { 
		
		while(!peers) {
			resps = this.urlAnnounce()
			peers = await Promise.race(resps)
			peers = peers.peerList
		}
	} 

	if(!peers) {
		//oh shit
	}



	this.swarm.connectPeers(peers)

	//wait for new peers
	
	//which peers to send interested msg to
	//which peers to unchoke
	//which requests to send

	//this.pieceQueue = []

	//chose peers to unchoke - every 10 sec

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
	
		let unchokeCandidates = Array.from(amUnchoked).sort( (p1, p2) => p1.uploadRate < p2.uploadRate )

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

	//piece downloader
	var downloadPiece = () => {

		peers = this.swarm.amUnchokedPeers()
		//get resend requests sent to peers that are now choked

		this.hist = this.swarm.piecesByFreq(peers) //assume peers are representative
		//random from most freq and least freq
		//update interested peers
		while( this.activePieces < 10 ) {
			let pIndex = this.hist(Math.floor(Math.pow(Math.random(), 3)))
			this.activePieces.add(new Piece(pIndex))
		}

		//download pieces from mutually unchoked peers in group (1) and amUnchoked peers in group (3)
		//swarm.amUnchokedPeers

	}

	var	downloadPiecelet = () => {

		let swarm = this.swarm
		let requests = this.requests
		let peers = swarm.amUnchokedPeers
		let idle = peers.intersection(swarm.idlePeers)
		let active = peers.difference(idle)

		var reqToRandomPeer = (function(index, start, length) {
			let havePiece = swarm.havePiece(index, peers)
			let randomPeer = Array.from(havePiece)[Math.floor(Math.random() * havePiece.size)]		
			let req = { index : index, begin : start, length : length, peer : randomPeer}
			req.timeout = setTimeout(()=>{ this.emit('request_timeout') }, 30 * 1e3)
			this.requests.push(req)
			randomPeer.request(start, begin, length)
		}).bind(this)

		//constants
		//outstanding requests per peer
		//number of outstanding requests
		//number of active pieces

		let resendReq = this.requests.filter( request => request.peer.pChoke || request.timeout._called )
		this.requests = this.requests.filter( request => !request.peer.pChoke && !request.timeout_called )

		while(this.requests.length < peers.size * 4 || resendReq.length > 0) {
			
			if(resendReq.length > 0) {

				let req = resendReq.shift()
				reqToRandomPeer(randomIndex, req.begin, req.length)

			} else {
				
				let piecelet
				let pieces = swarm.pieces(peers)
				let randomIndex, piece

				do {

					randomIndex = Math.floor(Math.random() * pieces.size)
					piece = Array.from(pieces)[randomIndex]

					let nextPiecelet = piece.next
					if(nextPiecelet)
						piecelet = nextPiecelet

				} (piecelet)

				reqToRandomPeer(randomIndex, piecelet.start, piecelet.begin)

			}

		}

	}

	this.on('recieved_piece', downloadPiece)
	this.on('recieved_piecelet', downloadPiecelet)
	this.on('request_timeout', downloadPiecelet)

	unchokeLoop()
	this.downLoop = setInterval(unchokeLoop, 10 * 1e3)

	optUnchokeLoop()
	this.optLoop = setInterval(optUnchokeLoop, 30 * 1e3)

	downloadPiece()
	downloadPiecelet()

}

Downloader.prototype.DHTAnnounce = async function() {

}

//infoHash, peerID, downloaded, left, uploaded, ev, IPAddress, key, numWant, port
//transactID, infoHash, peerID, stats, ip, key, numWant, port
Downloader.prototype.urlAnnounce = async function() {
	//stats = {downloaded, left, uploaded, ev}
	
	let sock = dgram.createSocket('udp4').bind()
	sock.on('listening') //tracker announce)

	let infoHash = this.fileMetaData.infoHash
	let peerID = this.peerID

	return  this.fileMetaData.announceUrlList.map( async (announceUrl) => {		

		if(announceUrl.slice(0,6) == 'udp://') { //udp tracker			
			let tracker = new UDPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats) 

		} else if (announceUrl.slice(0,7) == 'http://') {
			let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats)
		}
	})

}


