

Downloader = require('./swarm/index.js').Downloader


var client1 = new Downloader(6012)
client1.swarm.start()
//client1.setMetaInfoFile('../c_primer_5th_edition.torrent')
//client1.setMagnetUri('magnet:?xt=urn:btih:9401adf4f356feb3c629b3757f6d71430052fc8c&dn=c_primer_5th_edition.pdf')
//client1.setMetaInfoFile('../Dragon.mkv.torrent')
//client1.setMetaInfoFile('../ubuntu-17.04-desktop-amd64.iso.torrent')
//client1.setMetaInfoFile('../torrent-9318245.torrent')
client1.setMetaInfoFile('../Game.of.Thrones.S07E07.HDTV.x264-UAV[eztv].mkv.torrent')