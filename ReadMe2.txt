
dtorrent

Download files using bittorrent protocol

Synopsis

$ dtorrent [] --f file.torrent --m ''
$ dtorrent --help

Options

-h, --help

____________________________________________

bencode
magnet-uri
torrent-file
peer, fileobject?
fztorrentclient



peers = [] //choked, interested, amchoked, amintereted
//active peers 
//downloaders, uploaders - overlap
//peers have timer? to check last time choked/unchoked
//
//fibrillation - change whose choked once 10 sec
//unchoke four top uploaders who are interested
//if peer is not interested remove peerrequests, move to not interested lists, replace with peer >10 secs since last chokes
//
//
//setInterval(clbk, 10000) clbk 

//who to unchoke ??
//initially - have some pieces
//(if interested, peer wants a piece you have)
//wait for interested, then unchoke, randomly if more than 4 interested
//wait for amunchoke, reciprocate with unchoke if interested and < 4 uploaders or a downloader unchoked for more than 10 secs
//eventually all 4 unchokes are uploaders


'dtorrent'
node dtorrent -f somethin.torrent -m  

read magnet links or torrent file
verify valid

contact tracker - get list of peers
udp tracker protocol


//peers maintain list of requests...
//when a request is made, push new request to queue, emit
//request event...upto user to handle request

function swarm() {

peers = []
net = require('net')
this.server = net.socket.createServer() { 
	(socket) => {
		peer = new Peer()
		peers.push(peer)
		socket.pipe(peer).pipe(socket);
		// listeners ...
		peer.on('unchoke', () => // )
		peer.on('request', (..., response) => // response(//requested piece)) // never call piece(), use clbk on request event
		//also cancel
		peer.on('handshake' //)
		peer.on('fin') //wrap up connection
	}
}

}




magnet link, torrent file

link, file
torrent : file,files,meta data from .torrent file, magnet link, metadata exchange 
tracker : keeps list online trackers, makes http, udp requests

torrent = []

torrent <- File
torrent <- MetaData
torrent <- swarm
torrent <- [tracker]

swarms = []
swarm <- [peers]
 
trackers = []
tracker <- [torrent]

setup swarm with .torrent file or magnet link
swarm creates trackers, - sends http, udp announce request
gets peer list from trackers, creates and contacts peer 















