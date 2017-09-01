

Downloader = require('./swarm/index.js').Downloader

var client1 = new Downloader(6012)
client1.setMetaInfoFile('../c_primer_5th_edition.torrent')
//client1.setMetaInfoFile('../Dragon.mkv.torrent')
//client1.setMetaInfoFile('../ubuntu-17.04-desktop-amd64.iso.torrent')