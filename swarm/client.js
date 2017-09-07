
fs = require('graceful-fs')
util = require('util')
crypto = require('crypto')
net = require('net')
dgram = require('dgram')
Buffer = require('buffer').Buffer
events = require('events')
stream = require('stream')
dns = require('dns')
url = require('url')
querystring = require('querystring')


parseArgs = require('minimist')

term = require('terminal-kit').terminal
clipboardy = require('clipboardy')
Downloader = require('./index.js').Downloader

class Client {

	constructor() {

		this.port = 6000
		this.torrents = []
		
	}

	async addTorrent() {

		term.clear()
		term.down(1).right(1).bold('Reading torrent file...')

		this.args = []
		let downloader = new Downloader(++this.port) //need listen port

		try {

			if(this.file)		
				await downloader.setMetaInfoFile(this.file)
			else
				downloader.setMagnetUri(this.magnetURI)

		} catch (error) {

			this.screenFunc = this.displayTorrents
			return
		}

		this.torrents.push(downloader)
		this.file = this.magnetURI = null

		this.screenFunc = this.displayStatus
		this.args = [this.torrents.length - 1]
		this.idx = this.torrents.length - 1
		

	}

	log() {

		this.args = []
		this.screenFunc = this.displayStatus
		
		this.args = [this.idx]
		return new Promise( (resolve, reject) => {
			
			term.fullscreen(false)
			term.clear()

			term.once('key', (name) => { if(name == "ENTER") {
				term.fullscreen(true)
				resolve(null) 
			}} )

		})

	}

	async settings() {


	}

	async displayPieces() {

		let self = this
		let tor = this.torrents[this.idx]
		let pieces = tor.activePieces

		return new Promise( (resolve, reject) => {

			if(!this.noRefresh)
				term.clear()
			else 
				term.moveTo(0, 0)

			this.noRefresh = true

			var refresh = () => { resolve(null) }
			var t = setTimeout( refresh , 1 * 1e3)

			function repeat( num, char ) { let str ="" ; while(num -- > 0) str+=char; return str}

			let items = Array.from(pieces.values()).map( x => (x.index).toString().padStart(5) + "| " + repeat(x.piecelets.size, "#") 
				+ repeat( x.dispatchList.size, '+') + repeat( x.requestList.size - x.dispatchList.size - x.piecelets.size, '-') + "\n" )  

			if(items.length == 0) {
				self.noRefresh = false
				clearTimeout(t)
				self.screenFunc = self.displayStatus
				resolve(null)
			}

			let title = "Downloading"
			let escMsg = "Any key to return"
			term.clear().down(1).right(1).bold( title.padEnd(term.width - escMsg.length - 2) + escMsg)
			term.gridMenu( items, { y : 4, x : 2, exitOnUnexpectedKey : true, selectedStyle : term }, async function( error , response ) {
					
				self.noRefresh = false
				clearTimeout(t)

				if(error) 
					reject(error)

				self.screenFunc = self.displayStatus
				resolve(null)

			})

			//tor.swarm.once('recieved piece', (index) => term.bold("Recieved piece:" ))

		})

	}

	async app() {

		term.fullscreen(true)
		term.windowTitle("fztorrent")
		term.hideCursor()

		this.file = null
		this.magnetURI = null
		this.screenFunc = this.displayTorrents
		this.idx = null
		this.args = []
		this.noRefresh = false
		this.lastScreen = null

		this.opts = [" New Torrent", "List Torrents", "Start", "Stop", "Peers", "Log", "Pieces", "Settings", "Exit"]
		this.optScreens = [ this.linkOrFile, this.displayTorrents, 

		() => { 

			//if(this.screenFunc != this.displayStatus) this.screenFunc = this.di
			if(!this.torrents[this.idx].optLoop) this.torrents[this.idx].start() ; 
			this.args = []; 
			this.screenFunc = this.displayStatus 
		}, 

		() => { 
			this.torrents[this.idx].stop(); 
			this.args = []; this.screenFunc = this.displayStatus 
		},  

		this.displayPeers, this.log, this.displayPieces, this.settings, null]


		try {

			while(true) {

				if(!this.screenFunc)
					break

				let args = this.args.splice(0, this.args.length)
			
				await this.screenFunc(...args)

			}

		} catch(error) {

			console.log(error)

		}

		term.fullscreen(false)
		term.processExit()

	}

	async displayTorrents() {

		this.idx = null
		let self = this
		return new Promise( async (resolve, reject) => {

			let items = self.torrents.map( torrent => torrent.fileMetaData.name.slice(0, term.width /2 - 5) )
			let timeout = -1
			let progs = []

			if(items.length == 0) {

				self.screenFunc = self.linkOrFile
				resolve(null)

			} else {
			
				let title = "Select to view status"
				let escMsg = "Any key for actions"
				term.clear().down(1).right(1).bold(title).move(term.width - escMsg.length - title.length - 2, 0).bold(escMsg).singleColumnMenu( items, { y : 4, exitOnUnexpectedKey : true}, async function( error , response ) {
					
					progs.forEach( (pairs) => pairs[0].stop())
					clearTimeout(timeout)
					timeout = -1

					if(error) 
						reject(error)

					else if (response.unexpectedKey)
						self.screenFunc = self.actionBar
					
					else {

						self.screenFunc = self.displayStatus
						self.args = [response.selectedIndex]
						self.idx = response.selectedIndex
			
					}

					resolve(null)

				})

				self.torrents.forEach( (torrent, i) => {

					term.moveTo(term.width/2 + 1, 4 + i)
					let prog = term.progressBar( {
							width: term.width / 2 - 5 ,
							title: 'Complete:' ,
							eta: true ,
							percent: true
					})
					progs.push( [prog , torrent] )

				})

				timeout = null
				var update = (prog, torrent) => prog.update( torrent.pieces.size / torrent.fileMetaData.numPieces)
				var updateAll = () => {  if(! (timeout == -1)) { progs.forEach( (pair) => update(...pair) ) ; timeout = setTimeout( updateAll, 1e3);} } 
				updateAll()

			}
		})
	}

	linkOrFile() {

		this.idx = null
		let self = this

		return new Promise( async (resolve, reject) => {
			//term.once('resize', ()=> {resolve(null)})

			let items = ['Paste magnetUri', 'Select file']
			term.clear().down(1).right(1).bold("Add torrent").singleColumnMenu( items, { y : 4, exitOnUnexpectedKey : true}, async function( error , response ) {
				
				if(error) {
					reject(error)

				} else if (response.unexpectedKey) {

					self.screenFunc = self.actionBar
					resolve(null)

				} else if (response.selectedIndex == 0)
					self.screenFunc = self.readMagnetUri

				else if (response.selectedIndex == 1)
					self.screenFunc = self.selectFile

				resolve(null)

			})
		})
	}

	async readMagnetUri(clip1) {

		let self = this

		return new Promise( async (resolve, reject) => {
			//term.once('resize', ()=> {resolve(null)})

			clip1 = clip1 || clipboardy.readSync()

			term.clear().down(1).right(1).bold("Type in or paste magnetURI").moveTo(0, 4).inputField( { default : clip1, style : term.inverse}, (error, input ) => {

				if(error)
					resolve(error)

				self.magnetURI = input
				self.screenFunc = self.addTorrent
				this.args = []
				resolve(null)

			})

			let clip2 = await clipboardy.read()

			if(clip1 != clip2) {

				//this.screen = 'read magnetUri'
				self.screenFunc = self.readMagnetUri
				self.args = [clip2]
				resolve(null)

			}

		})

	}

	async actionBar ( actions ) {

		let self = this
		this.noRefresh = false
		actions = actions || this.opts

		return new Promise( (resolve, reject) => {

			term.singleLineMenu( actions , { y : term.height-1 , separator : " | ", exitOnUnexpectedKey : true},  function( error , response ) {
				
				if(error)
					reject(error)

				if(response.unexpectedKey) {
					resolve(null)

				} else {

					if( self.lastScreen != self.displayStatus &&  response.selectedIndex >= 2 && response.selectedIndex <= 6 )
						return resolve(null)

					self.lastScreen = self.screenFunc
					self.screenFunc = self.optScreens[response.selectedIndex]
					resolve(null)

				}
	
			})

		})
	}

	async displayPeers() {

		let self = this
		let stats = this.torrents[this.idx].swarm.peerStats
		this.args = []

		return new Promise( (resolve, reject) => {

			if(!this.noRefresh)
				term.clear()//.nextLine(1).right(1).green("Connected peers:").nextLine(2)
			else
				term.moveTo(0, 0)

			this.noRefresh = true
			var refresh = () => { resolve(null) }
			var t = setTimeout( refresh , 1 * 1e3)

			let i = 0
			let items = Array.from(this.torrents[this.idx].swarm.peers).map( (peer) => { 
			
				let address = peer.sock.remoteAddress.toString()
				let dSpeed = Math.round(stats.get(peer.peerID).downRate / 100)/10 + " KB/s"
				let uSpeed = Math.round(stats.get(peer.peerID).upRate / 100)/10 + " KB/s"
				let str = ((i++).toString().padStart(2)) + ". " + address 
				return str.padEnd( term.width/2 - 20 )+ "  dl: " + dSpeed + " ul: " + uSpeed

			}).slice(0, term.height - 5)

			if(items.length == 0)
				return resolve(null)

			let title = "Connected peers"
			let escMsg = "Any key to return"
			term.clear().down(1).right(1).bold( title.padEnd(term.width - escMsg.length - 2) + escMsg)
			term.singleColumnMenu( items, { y : 4, exitOnUnexpectedKey : true, selectedStyle : term}, async function( error , response ) {
					
				self.noRefresh = false
				clearTimeout(t)

				if(error) 
					reject(error)

				self.screenFunc = self.displayStatus
				resolve(null)

			})	

		})
	}

	async displayStatus() {

		let self = this
		let idx = this.idx
		this.lastScreen = this.displayStatus

		return new Promise( async (resolve, reject) => {
			
			if(!this.noRefresh)
				term.clear()
			else
				term.moveTo(0, 0)

			this.noRefresh = true

			let title = "Name:"
			let escMsg = "Any key for actions"
			term.down(1).right(1).bold(title + " " + this.torrents[idx].fileMetaData.name).move(term.width - title.length - escMsg.length - this.torrents[idx].fileMetaData.name.length- 3).bold(escMsg)

			let tor = this.torrents[idx]
			//term.green(this.torrents[idx].fileMetaData.name)
			term.nextLine(2)
			term.right(1).bold("Info hash: " + this.torrents[idx].fileMetaData.infoHash.toString('hex'))
			term.nextLine(1)
			term.right(1).bold("Have metadata: " + this.torrents[idx].fileMetaData.ready + "   ")
			term.nextLine(1)
			term.right(1).bold("File length: " + this.torrents[idx].fileMetaData.fileLength + " (bytes)")
			term.nextLine(1)
			term.right(1).bold("Piece length: " + this.torrents[idx].fileMetaData.pieceLength + " (bytes)")
			term.nextLine(1)
			term.right(1).bold("Total pieces: " + this.torrents[idx].fileMetaData.numPieces)
			term.nextLine(1)
			term.right(1).bold("Pieces on disk: " + tor.pieces.size)
			term.nextLine(2)
			
			term.right(1).bold("Peers discovered: " + tor.swarm.peerStats.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Connected peers: " + tor.swarm.peers.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Seeders: " + tor.swarm.seeders.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Leechers: " + tor.swarm.leechers.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Interested: " + tor.swarm.interestedPeers.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Unchoking: " + tor.swarm.unchokedPeers.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Interested peers: " + tor.swarm.amInterestedPeers.size + "  ")
			term.nextLine(1)
			term.right(1).bold("Peers unchoking: " + tor.swarm.amUnchokedPeers.size + "  ")

			term.nextLine(2)
			var progress = Math.round(tor.pieces.size / tor.fileMetaData.numPieces * 1000) /10
			term.right(1).bold("Completed: " + progress + " %  ")
			term.nextLine(1)
			var repeat = (char, num) => { let str = ""; while(num --> 0) str += char; return str}
			term.right(1).green(repeat("=", (term.width - 3) * progress / 100)).green( progress ? ">" : "")
			term.nextLine(1)
			term.right(1).bold( "Download rate: " + Math.round(tor.swarm.globalDownRate / 100)/10 + " KB/s    ") 	
			term.nextLine(1)

			var timeLeft = (tor.fileMetaData.numPieces - tor.pieces.size) * tor.fileMetaData.pieceLength / tor.swarm.globalDownRate
			term.right(1).bold( "ETA: " + (Math.floor(timeLeft / 60 / 60) + "hrs " + Math.floor(timeLeft / 60) % 60 + "mins " + Math.round(timeLeft % 60) + "secs      ")  )
			term.nextLine(1)
			term.right(1).bold( "Upload rate: " + Math.round(tor.swarm.globalUpRate / 100)/10 + " KB/s    ")
			term.nextLine(1)

			term.right(1).bold( tor.seeding ?  "Seeding...  " : "Leeching...")
			term.nextLine(1)

			var i = 0
			term.moveTo(term.width / 2, 4).bold("Trackers:")
			Array.from(Object.values(tor.trackers)).slice(0, 15).forEach( tracker => {
				if(tracker.online)
					term.moveTo(term.width /2, 5 + i++).green(tracker.host + "\n")
				else 
					term.moveTo(term.width /2, 5 + i++).red(tracker.host + "\n")
			})

			setTimeout( () => { this.args = [true]; resolve(null) }, 1 * 1e3)


			term.once('key', (name) => { 

				this.args = []
				this.noRefresh = false
				this.screenFunc = this.actionBar

				resolve(null) 
			
			})
			

		})
	}	



	selectFile() {
	
		let self = this
		return new Promise ((resolve, reject) => {
		//	term.once('resize', ()=> {resolve(null)})

		var path = process.cwd()
		var items = fs.readdirSync( path ) ;
		items.unshift("..")

		function traverse(items, path) {

			term.clear().down(1).right(1).cyan( 'Choose a file:\n' ).moveTo(0, 4).right(1).green(path).green("\n").gridMenu( items , { exitOnUnexpectedKey : true}, function( error , response ) {

				if(error)
					return traverse(items, path)
		
				if(response.unexpectedKey || !response.selectedText) {

					self.screenFunc = self.actionBar
					resolve(null)
					return

				}

				var newPath = fs.realpathSync(path + "\\" + response.selectedText)
				var stat = fs.lstatSync(newPath)

				if(stat.isDirectory()) {

					var items = fs.readdirSync( newPath) ;
					items.unshift("..")
					traverse(items, newPath)

				} else {
					
					self.screenFunc = self.addTorrent	
					self.file = newPath
					resolve(null)

				}
			}) 
		}

		traverse(items, path)

	})}

}


if( require.main == module) {

	var argv = require('minimist')(process.argv.slice(2))

	if(argv.ui || argv.u) {

		client = new Client()
		client.app().catch(x => console.log(x))

	} else {

		async function startup() {

			let port = argv.p || argv.port

			client = new Downloader(port || 9000)

			let file = argv.f || argv.file 

			if(file) 
				await client.setMetaInfoFile(file)

			let magnet = argv.m || argv.magnet || argv.magnetURI || argv.magnetLink || argv.magnetlink
			if(magnet)
				client.setMagnetUri(magnet)

			if(!file && !magnet)
				throw new Error("No file or magnet link")

			console.log("Starting torrent...")

			client.start()

			console.log( client.seeding ? "Seeding..." : "Downloading...")

			if(argv.p) {
	
				let prog = term.progressBar( {
						width: term.width - 2,
						title: 'Complete:' ,
						eta: true,
						percent: true
				})
			
				let update = () => { 
					prog.update( client.pieces.size / client.fileMetaData.numPieces) 
					setTimeout( update, 1e3 )
				}

				update()

			}

		}

		try {
		
			startup() 
		
		} catch (error) {

				console.log(error)
				process.exit()

		}

	}

} else {

	module.exports = {

		Client : Client

	}

}