
var Server = require('bittorrent-tracker').Server
var server = new Server({udp : true, http : false, ws : false, stats : false})
server.on('start', function(addr) {console.log('got start message from ' + addr)})
server.listen(3000)