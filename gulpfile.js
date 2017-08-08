
const gulp = require('gulp')
const createServer = require('./index.js').createServer
const createSocket = require('./index.js').createSocket
const getPort = require('get-port')
const fs = require('fs')
var Q = require('q')
var exec = require('gulp-exec')

gulp.task('test', (cb) => {
		console.log('Testing uTP');

		server = createServer()
		sock = createSocket()
		
		/*server.cheat.on('finish', () => {
				console.log("closing")
				//sock.close()
				//sock.on('closed', cb)
				cb()
		})*/
		//sock.on('finish', cb)
		
		getPort().then(port => {
			console.log('Server: listening on port', port)
			
			//server.on('connection', (server_sock)=> {server_sock.pipe(process.stdout)})
			server.listen(port)
					
			sock.connect(port)
			f = fs.createReadStream('../../number.txt')
			sock.on('connected', f.pipe(sock))
			
		});
		setTimeout(cb, 2000)
		//return f
		
});


//git stash create > t.txt
//set  /p VAR=<t.txt
//git archive %VAR% -o latest2.tar
//sudo scp -i f4188.pem "/mnt/c/Users/Fawaz A/Documents/Workspace/fztorrent/uTP/latest.tar" ec2-user@54.158.235.118:/home/ec2-user/
//tar -xf latest.tar -C latest

gulp.task('transfer', function(cb) {
	exec('git stash create', function(err, stdout, stderr) {
		console.log(stdout)
		exec('git archive ${stdout} -o latest2.tar', function(err, stdout, stderr) {
			console.log('worked')
			cb(err)
		})
		
	})




})

gulp.task('watch', function() {
	gulp.watch(['lib/*.js', '*.js'], ['transfer'])
})