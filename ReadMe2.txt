
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


check if file exists, if locked or in use by another program

______________________________________


	/* :::: for leechers ::::

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

	
	
	
	
	'ae11067a70121017eaebed84d7c8a99afb6cc860',
  'ae16b54673b836c8215c88581e9974eaa3968c51',
  'ae11170e9753df2ac6bca9fcbf1f8feb3f27ee6a',
  'a94b18c3f770bdded2a31832e76ddcb5298341d6', <-
  'ae11173c870c3e99245e0d1c06b747deb3124da6',
  'af96cd2359caed9568dc0a246ee50c9d0157f331', <-
  'ae11176f149ef80e6b5bbb7f98ff158d036a124a',
  'afcf80637e73b4e6b7e3303ee175cd397c6289db' ] <-


[ 'ae12d6027d41876f3e30690120fceef110308b3c',
  'ae135911d719c66ec5d15f80fc967c1e5747688e',
  'ae117df423ce96938ef7221caeac02be42c38669',
  'a94b18c3f770bdded2a31832e76ddcb5298341d6', <-
  'ae1031a62301b17f8619b437345caa2bc23f3afb', 
  'af96cd2359caed9568dc0a246ee50c9d0157f331', <-
  'ae1323a7b3b764a4bbe25a9d85a8dbdac63969ac',
  'afcf80637e73b4e6b7e3303ee175cd397c6289db' ] <-













