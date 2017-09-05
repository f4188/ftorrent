

Downloader = require('./swarm/index.js').Downloader


var client1 = new Downloader(6012)
client1.swarm.start()
//client1.setMetaInfoFile('../c_primer_5th_edition.torrent')
//client1.setMagnetUri('magnet:?xt=urn:btih:9401adf4f356feb3c629b3757f6d71430052fc8c&dn=c_primer_5th_edition.pdf&tr=udp%3A%2F%2F127.0.0.1%3A3000')
client1.setMagnetUri('magnet:?xt=urn:btih:32843bef0b20ba67b095ec47d923f90c64bc7787&dn=Wonder.Woman.2017.HDTS.1080P.x264&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Fzer0day.ch%3A1337&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Fexodus.desync.com%3A6969')
//client1.setMagnetUri('magnet:?xt=urn:btih:8670c2de1bc5ff38d70dc8215ed4e24a63a4fee8&dn=Game.of.Thrones.S07E07.HDTV.x264-UAV%5Beztv%5D.mkv&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969')
//client1.setMetaInfoFile('../Dragon.mkv.torrent')
//client1.setMetaInfoFile('../ubuntu-17.04-desktop-amd64.iso.torrent')
//client1.setMetaInfoFile('../torrent-9318245.torrent')
//client1.setMetaInfoFile('../Game.of.Thrones.S07E07.HDTV.x264-UAV[eztv].mkv.torrent')
//client1.setMetaInfoFile('../7BED80C7F9F754EFFA35802416881209CF23D089.torrent')


