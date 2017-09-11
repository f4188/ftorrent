const {app, BrowserWindow, Menu, dialog} = require('electron')

ipcMain = require('electron')
clipboardy = require('clipboardy')


 //require('electron-titlebar') 
//const ElectronTitlebarWindows = require('electron-titlebar-windows')

var mainWindow = null;

app.on('window-all-closed', function() {

  if (process.platform != 'darwin') {
    app.quit();
  }

});

app.on('ready', function() {

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    'min-width': 500,
    'min-height': 200,
    'accept-first-mouse': true,

    //'title-bar-style': 'hidden',
   // frame : false
  });

  mainWindow.setMenu(null)
  mainWindow.loadURL('file://' + __dirname + '/index.html');

  // Open the DevTools.
  mainWindow.openDevTools();

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  })
})




