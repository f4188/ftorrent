
net = require('net')

//currently connected peers
function Swarm() { //ip list

	this.peers = []
	//this.badPeers 
	//

	//lists updated by listeners on events emitted by peers
	this.amUnchoked = [] 
	this.amInterested = []

	this.connecting = []
	this.disconnected = []

	this.UTPserver = uTP.createServer() // ...
	this.TCPserver = net.createServer().listen()

	self = this

	this.TCPserver.on('connection', (function(sock) {
		let peer = new Peer(sock, file, false) //peer owns socket
		self.setListeners(peer)
		peer.on('connected', )
		sock.resume()
	}))
}

Swarm.prototype.connectPeer = function (addr) {

	opts = {'allowHalfOpen' : false, 'pauseOnConnect' : true}
	sock = net.createConnection()
	sock.connect(addr.port, addr.host)

	return new Promise(resolve, reject) {

		let timeout = setTimeout(()=> {
			reject("peer timeout")
		}, this.defaultTimeout)

		sock.on('connected', ()=> {	
			let peer = new Peer(sock, file, true) //init is true - send handshake
			self.setListeners(peer)
			peer.on('connected', () => { //after recieving handshake
				clearTimeout(timeout)
				resolve(peer) 
			})
			sock.resume()
		})
	}
}

Swarm.prototype.connectManyPeers = function (addrs) {
	return addrs.map( (addr) => connectPeer(addr) )
}

Swarm.prototype.addPeers = function (addrs) {
	connectManyPeers.forEach( async (promise) => {
		try {
			peer = await promise
			this.peers.push(peer)
		}
		// do something
		//if bad peer discard
		//
	})
}

Swarm.prototype.newPeers = function () {

}

Swarm.prototype.piecesByFreq = function () {

	let freq = {}

	this.peers.reduce((peer, freq) => {
		peer.pieces.forEach(piece => {
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

	return freq

}

Swarm.prototype.setListeners = function (peer) { //called after tcp or uTP connection established
	
	let self = this

	peer.on('peer_unchoked', () => {
		self.amUnchoked.push(peer)
	})
	peer.on('peer_choked', () => {
		let index = self.amUnchoked.findIndex(peer)
		self.amUnchoked.splice(index, 1)
	})
	peer.on('peer_interested', () => {
		self.amInterested.push(peer)
	})
	peer.on('peer_uninterested', () => {
		let index = self.amInterested.findIndex(peer)
		self.amInterested.splice(index, 1)
	})
	peer.on('peer_request', function(request){ //only if unchoked
		let start = request.index * piece_length + request.begin
		let end = request.index * piece_length + request.begin + request.length
		peer.piece(request.index, request.begin, request.length, fs.createReadStream(path, {'start': start, 'end' : end} ))
	}) 
	peer.on('peer_piece', function(piece) {
		let start = piece.index * piece_length + piece.begin
		var rs = fs.createWriteStream(path, {'start': start, 'mode':'r+'} )
		rs.write(piece.piece)
		rs.end()
		//check piece hash
	})
	
}

/*
downloader = Downloader()

client = startUpClient()
client.addTorrent(path to torrent file/uri or magnet uri in string form) 

*/

//
function Downloader() {

	this.pieces = []

	this.unchoked = []
	this.interested = []
	this.peerID 
	this.port
	//this.amUnchoked = this.swarm.amUnchoked
	//this.amInterested = this.swarm.amInterested

	this.announceUrlList = []

	/*
	this.file  = {
		'infoHash' : 0,
		'name' : , //name of file
		'piece_length' : , //piece length
		'pieces' : , //hashes of pieces
		'length' : 0, //length of file in bytes
	}*/

	this.fileMetaData = {
		'announceUrlList' : "",
		'date' : "", 
		'infoHash' : null,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, //num pieces = fileLength / pieceLength
		'pieceHashes' : [],
	}

	this.file = this.fileMetaData
 
	
	this.stats = {
		'downloaded': 0,
		'left': 0,
		'uploaded': 0,
		'ev': null //???
	}

	this.pieces = []

	this.swarm = new Swarm(this.file)

}

Downloader.prototype.setupWithMetaInfoFile = function(metaInfoFilePath) {
	//is path
	let metaInfo
	if(fs.existsSync(metaInfoFilePath)) {
		metaInfo = bdecode(fs.readFileSync(metaInfoFilePath))
	}

	let {announceUrlList, date, info} = metaInfo

	this.metaInfo 

	/*
	this.fileMetaData = {
		'announceUrlList' : "",
		'date' : "", 
		'infoHash' : null,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, //num pieces = fileLength / pieceLength
		'pieceHashes' : [],
	}*/

	let fileMetaData = this.fileMetaData

	fileMetaData.announceUrlList = announceUrlList
	fileMetaData.date = date
	fileMetaData.name = m.name
	fileMetaData.pieceLength = m.piece_length
	fileMetaData.fileLength = m.length
	fileMetaData.pieceHashes = //m.pieces.match(/.{})

}

Downloader.prototype.setupWithMagnetUri = function(magnetUri) {

}

Downloader.prototype.checkDisk = function() {

}

//start or resume download or seed
Downloader.prototype.start = function() {
	//read torrent file or parse magnet link
	//this.infoHash

	//on startup check disk
	//if file complete seed
	//if file incomplete, verify pieces, begin leeching


	//announce to trackers
	//get peer lists
	if() { //no peers
		this.peerLists = this.announce().map( x => x.peerList ) 
	}

	//setup swarm
	this.swarm.connectPeers()

	//wait for new peers
	
	//which peers to send interested msg to
	//which peers to unchoke
	//which requests to send

	this.pieceQueue = []

	//chose peers to unchoke - every 10 sec

	setInterval( () => {

		//sort by upload rate
		unchoked = this.unchoked.filter(peer => peer.amchoked()) //remove idle peers and peers amchoked peers
		unchokedAndIdle = this.unchoked.filter() //currently fulfilling request or having request fulfilled

		candidates = this.swarm.amUnchoked.sort( (p1, p2) => p1.uploadRate >= p2.uploadRate)


		//chose best cand and put in this.unchoke
		while() {

			candidate = candidates.shift()
			candidate.unchoke()
			this.unchoked.push(candidate)

		}

		//update pieceQueue - choose next pieces
		hist = this.swarm.piecesByFreq()
		//random from most freq and least freq
		//update interested peers
		this.pieceQueue

		//push requests to peers


	}, 600 * 1e3)
	//chose new optimistic unchoke every 30 sec

}

Downloader.prototype.DHTAnnounce = async function() {

}

//infoHash, peerID, downloaded, left, uploaded, ev, IPAddress, key, numWant, port
//transactID, infoHash, peerID, stats, ip, key, numWant, port
Downloader.prototype.urlAnnounce = async function() {
	//stats = {downloaded, left, uploaded, ev}
	
	let sock = dgram.createSocket('udp4').bind()
	sock.on('listening') //tracker announce)

	let infoHash = this.file.infoHash
	let peerID = this.peerID

	return  this.announceUrlList.map( async (announceUrl) => {		

		if(announceUrl.slice(0,6) == 'udp://') { //udp tracker			
			let tracker = new UDPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats) 

		} else if (announceUrl.slice(0,7) == 'http://') {
			let tracker = new HTTPTracker(sock, announceUrl, infoHash, peerID)
			return await tracker.doAnnounce(this.stats)
		}
	})
}

class Torrent {

	constructor() {

		this.downloader = new Downloader()

	}

}


















