
net = require('net')

function Swarm() { //ip list

	this.peers = []

	//lists updated by listeners on events emitted by peers
	this.amUnchoked = [] 
	this.amInterested = []

	this.connecting = []
	this.disconnected = []

	this.UTPserver = uTP.createServer() // ...
	this.TCPserver = net.createServer().listen()

	self = this

	this.TCPserver.on('connection', (function(sock) {
		let peer = new Peer(sock, false) //peer owns socket
		self.setListeners(peer)
		
	}))
}

Swarm.prototype.connectPeer = function (addr) {
	sock = net.createSocket()
	sock.connect(addr.port, addr.host)
	return new Promise(resolve, reject) {
			//reject on timeout
		sock.on('connected', ()=> {	
			let peer = new Peer(sock, true)	
			self.setListeners(peer)
			this.on('connected', () => { resolve(peer) })
		})
	}
}

Swarm.prototype.connectManyPeers = function (addrs) {
	this.peers.concat( addrs.map((addr) => connectPeer(addr) ) )
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


*/

function Downloader() {

	this.swarm //= new Swarm()
	this.pieces = []
	this.file

	this.unchoked = []
	this.interested = []
	this.peerID
	this.port
	//this.amUnchoked = this.swarm.amUnchoked
	//this.amInterested = this.swarm.amInterested

	//read torrent file or parse magnet link
	//this.infoHash

	this.announceUrlList

	this.file  = {
		'infoHash' : 0,
		'name' : , //name of file
		'piece_length' : , //piece length
		'pieces' : , //hashes of pieces
		'length' : 0, //length of file in bytes
		'hashList' : [],
	}

	this.file = {
		'announceUrlList' : "",
		'date' : "", 
		'infoHash' : null,
		'name' : "",
		'pieceLength' : null,
		'fileLength' : null, //num pieces = fileLength / pieceLength
		'pieceHashes' : [],
	}

	//on startup check disk
	//if file complete seed
	//if file incomplete, verify pieces, begin leeching
	let stats = {
		'downloaded',
		'left',
		'uploaded',
		'ev'
	}

	this.pieces = []

	//announce to trackers
	//get peer lists
	this.peerLists = this.announce().map( x => x.peerList )

	this.swarm = new Swarm()
	this.swarm.connectWith()
	//setup swarm
	//which peers to send interested msg to
	//which peers to unchoke
	//which requests to send

}

//infoHash, peerID, downloaded, left, uploaded, ev, IPAddress, key, numWant, port
//transactID, infoHash, peerID, stats, ip, key, numWant, port
Downloader.prototype.announce = async function() {
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

























