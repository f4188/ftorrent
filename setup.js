

Downloader = require('./swarm/index.js').Downloader

var client1 = new Downloader(6001)
client1.setupWithMetaInfoFile('../c_primer_5th_edition.torrent')


//var client2 = new Downloader(6002)
//client2.setupWithMetaInfoFile('../c_primer_5th_edition.torrent')

client1.start().catch(x => console.log(x))
//client2.start().catch(x => console.log(x))