

Downloader = require('./swarm/index.js').Downloader

var client = new Downloader()
client.setupWithMetaInfoFile('../c_primer_5th_edition.torrent')
client.start().catch(x => console.log(x))