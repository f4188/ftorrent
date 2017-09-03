
//EXTENDED_MSG_TYPE
const EXTENDED_MSG_TYPE = 20 
const METADATAEX_MSG_TYPE = 1
//PPEEREX_MSG_TYPE
const METADATA_PIECE_LEN = 2 ** 16

benEncode = require('bencode').encode

/*
	Peer = MetaDataExchange(PeerExchange(Peer))
	UT_METADATA(UT_PEEREX(Peer))
	ut_metadata(ut_peerex(Peer))
	UTMetaData(PeerEx(Peer))
*/

let UTMetaDataEx = (SuperClass) => class MetaDataEx extends SuperClass {

	constructor( ...args ) {

		super(...args)

		this.recvExtensions['ut_metadata'] = [METADATAEX_MSG_TYPE]
		this.msgHandlers[EXTENDED_MSG_TYPE][METADATAEX_MSG_TYPE] = this.router
		this.metaInfoPieces = new Map()
		this.total_size = null

		let self = this
		
		this.on('connected', () => {

			if(self.supportedExtensions['ut_metadata'] && !self.fileMetaData.metaInfoRaw)
				self.metaDataExRequest(0)

		})
		

	}

	/*isSeeder() {

		if(!this.fileMetaData.metaInfoRaw) 
			return false
		else 
			super.isSeeder()

	}


	bitfield() {

		if(!this.fileMetaData.metaInfoRaw)
			return
		else 
			super.bitfield()

	}*/

	router(args) {

		switch([args.msg_type]) {
			case 0 :
				this.pMetaDataExRequest(args)
				break
			case 1 :
				this.pMetaDataExData(args)
				break
			case 2 :
				this.pMetaDataExReject(args)
				break
		}

	}

	pMetaDataExRequest(args) {

		let piece = args.piece

		if(this.fileMetaData.metaInfoRaw != null)
			this.metaDataExData(piece, this.MetaData.metaInfoRaw.slice(piece * METADATA_PIECE_LEN, (piece + 1) * METADATA_PIECE_LEN))
		else 
			this.metaDataExDataReject(piece)

	}

	pMetaDataExData(args) {

		let { piece, total_size, data } = args
		this.total_size = total_size

		this.metaInfoPieces.set(piece, data)
		if(total_size && this.metaInfoPieces.size * METADATA_PIECE_LEN < total_size) {

			let numPieces = Math.ceil(total_size / METADATA_PIECE_LEN)
			let peicesLeft = Array.from((new NSet([...Array(numPieces).keys()])).difference(new NSet(this.metaInfoPieces.keys())))
			this.metaDataExRequest(piecesLeft[0])

		} else {

			let buf = new Buffer(0)

			for (index of [...Array(numPieces).keys()]) {
				buf = Buffer.concat(buf, this.metaInfoPieces(index))
			}

			this.fileMetaData.metaInfoRaw = buf
			this.emit('got_meta_data', buf)

		}

	}

	pMetaDataExReject(args) {

		let {piece} = args

	}

	piecesLeft() {

		if(this.total_size) {


			this.metaInfoPieces

		}

		return null

	} 

	metaDataExRequest(index) {

		let reqMsg = benEncode({'msg_type': 0, 'piece': index })
		this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], reqMsg))

	}

	metaDataExData(index, data) {
		console.log('sending metaData')
		let dataMsg = benEncode({'msg_type': 1, 'piece': index, 'total_size': this.file.metaInfoSize})
		this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], dataMsg, data))

	}

	metaDataExDataReject(index) {
		
		let rejectMsg = benEncode({'msg_type': 2, 'piece': index})
		this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], rejectMsg))

	}

}

module.exports = {
	UTMetaDataEx : UTMetaDataEx
}