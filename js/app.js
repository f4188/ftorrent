
angular = require('angular')
Downloader = require('./swarm/index.js').Downloader
DHT = require('./dht/index.js').DHT
randomBytes = require('crypto').randomBytes
const getPort = require('get-port')
const fs = require('fs')

const {dialog} = require('electron').remote
const {BrowserWindow} = require('electron').remote
const {clipboard} = require('electron').remote
const ipcRenderer = require('electron').ipcRenderer

var app = angular.module('App', [])

app.controller('MainWindow', function($scope, $interval) {

  $scope.dht = null 

  let setupDHT = async () => {

    console.log('setupDHT')
    let dht = $scope.dht
    if(!$scope.dht) {

      let port = await getPort()
      dht = new DHT(port, "")
      $scope.dht = dht

    }

    if(fs.existsSync("./savedDHT"))
      await dht.loadDHT()

    else {

      try {
        
        await dht.bootstrap(true) 

      } catch( error ) {

        console.log(error)
        setTimeout( setupDHT , 10 * 1e3)

      }
    }

  }

  setupDHT()

  $scope.magnetURI = null 

  $scope.torrents = []
  $scope.torrentIdx = null
  var statusMessages = ["initializing", "reading torrent file", "announcing", "connecting peers", "fetching metadata", "reading metadata","downloading", "seeding" ]

  var timeLeft = (tor) => tor.swarm.globalDownRate ? (tor.fileMetaData.numPieces - tor.download.pieces.size) * tor.fileMetaData.pieceLength / tor.swarm.globalDownRate : "~" 
  var eta = (tor) => Math.floor(timeLeft(tor) / 60 / 60) + "hrs " + Math.floor(timeLeft(tor) / 60) % 60 + "mins "
  var calcProgress = (tor) => Math.round(tor.download.pieces.size / tor.fileMetaData.numPieces * 1000)/10

  $scope.calcProgress = calcProgress
  $scope.isHidden = (torrent) => torrent.state == 2 || torrent.state == 3
  $scope.isSelected = (index) => index == $scope.torrentIdx

  let fileLeft = (torrent) => (torrent.fileMetaData.numPieces - torrent.download.pieces.size) * torrent.fileMetaData.pieceLength
  let progress = (torrent) => {

    let status = torrent.state
    let msg ="  "

    if(!torrent.fileMetaData.ready)
      msg += "~"
    else 
      msg += calcProgress(torrent) + " %"

    if(torrent.state == 1 ) {

      msg += " | DL: " + Math.round(torrent.swarm.globalDownRate / 100) / 10 + " KB/s"
      msg += " | UL: " + Math.round(torrent.swarm.globalUpRate / 100) / 10 + " KB/s"

      if(torrent.fileMetaData.ready)
        msg += " | " + ((fileLeft(torrent) >= (2 ** 20)) ? (Math.round( (fileLeft(torrent) / (2**20)) * 10) / 10 + " MiB") : Math.round( (fileLeft(torrent) / (2**10)) * 10) / 10 + " KiB")
      
      if(torrent.fileMetaData.ready && torrent.fileMetaData.globalDownRate > 0 )
        msg += " | " + eta(torrent)
    }

    return msg

  }

  $scope.selectTorrent = (index) => { $scope.torrentIdx = index }


  let getStatus = (torrent) => {
  
      let status = torrent.state

      let msg = ""
      if(torrent.state == 4) //uninitialized or stopped
        return msg
      if(torrent.state == 0)
        msg += "seeding"
      else if(torrent.state == 1)
        msg += "downloading"
      else if( torrent.actions['reading_file'])
        msg += "reading torrent file"
      else if(torrent.actions['announcing'])
        msg += 'announcing'
      else 
        msg += 'initializing'
      
      if(torrent.actions['checking_disk'])
        msg += ' | checking disk'
      
      if(torrent.swarm.peers.size > 0) {
        msg += " | " + torrent.swarm.peers.size + " peers | " + torrent.swarm.amUnchokedPeers.size + " uploading | " + torrent.swarm.unchokedPeers.size + " downloading"
      }

      if( (torrent.state == 0 || torrent.state == 1) && torrent.actions['announcing'])
        msg += " | announcing"

      if (torrent.actions['fetching_metadata'])
        msg += " | fetching metadata..." 
      if(torrent.actions['connecting'])
        msg += " | connecting peers"

      return msg

  }

  $scope.progress = progress
  $scope.getStatus = getStatus
 
  $scope.start = (torrent) => { torrent.start() }
  $scope.stop = (torrent) => { torrent.stop() }
  $scope.delete = (torrent, index) => { torrent.stop(); $scope.torrents.splice(index, 1) }

  $scope.openFile = async () => {

    let fileName = await openFileDialog()

    if(!fileName)
      return

    let port = await getPort()
    let downloader = new Downloader(port, null, $scope.dht, true)
    downloader.enableDHT = true

    downloader.progress = progress(downloader)
    downloader.getStatus = getStatus(downloader)

    $scope.torrents.push(downloader)

    $scope.$watch( () => progress(downloader), (newVal, oldVal) => { downloader.progress = newVal} )
    $scope.$watch( () => getStatus(downloader) , (newVal, oldVal) => { downloader.getStatus = newVal } )

    $interval( () => downloader.progress = progress(downloader), 1e3)
    $interval( () => downloader.getStatus = getStatus(downloader), 1e3)

    try {
    
      await downloader.setMetaInfoFile(fileName)
      downloader.start()
      
    } catch (error) {

      console.log(error)

    }
        
  }

  $scope.openMagnetUri = async () => {

    let port = await getPort()
    let downloader = new Downloader(port, null, $scope.dht, true)
    downloader.enableDHT = true

    try {

      downloader.setMagnetUri($scope.magnetURI)

      downloader.progress = progress(downloader)
      downloader.getStatus = getStatus(downloader)

      $scope.torrents.push(downloader)

      $scope.$watch( () => {  return progress(downloader)}, (newVal, oldVal) => { downloader.progress = newVal} )
      $scope.$watch( () => getStatus(downloader) , (newVal, oldVal) => { downloader.getStatus = newVal } )

      $interval( () => downloader.progress = progress(downloader), 1e3)
      $interval( () => downloader.getStatus = getStatus(downloader), 1e3)

      downloader.start()
     
    } catch (error) {

      console.log(error)

    }

  }

})

function openFileDialog() {

  return new Promise( (resolve, reject) => {

   dialog.showOpenDialog((fileNames) => {

    if(fileNames) 
      resolve(fileNames[0])
    else 
      reject()

  })

 })

}











