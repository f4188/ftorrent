

Downloader = require('./swarm/index.js').Downloader

var client1 = new Downloader(6012)
client1.setMetaInfoFile('../c_primer_5th_edition.torrent')