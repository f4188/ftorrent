const crypto = require('crypto')


const EXTENDED_MSG_TYPE = 20
const META_MSG = 14 //kill
const METADATAEX_MSG_TYPE = 1
const METADATA_PIECE_LEN = 2 ** 14

benEncode = require('bencode').encode
benDecode = require('bencode').decode

let UTMetaDataEx = (SuperClass) => class MetaDataEx extends SuperClass {

	constructor( ...args ) {

		super(...args)

		this.recvExtensions['ut_metadata'] = METADATAEX_MSG_TYPE
		this.msgHandlers[EXTENDED_MSG_TYPE][METADATAEX_MSG_TYPE] = (this.router).bind(this)

		//this.msgHandlers[META_MSG] = {}	//kill
		//this.msgHandlers[META_MSG][METADATAEX_MSG_TYPE] = (this.router).bind(this) //kill
		this.metaInfoPieces = new Map()
		this.total_size = null
				
	}

	init() {

		if(this.supportedExtensions['ut_metadata'] != undefined && !this.fileMetaData.metaInfoRaw)
			this.metaDataExRequest(0)

	}
 
	isSeeder() {

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

	}

	router(args) {

		switch(args.msg_type) {
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
		
		if(!this.fileMetaData.metaInfoRaw)
			this.metaDataExData(piece, this.MetaData.metaInfoRaw.slice(piece * METADATA_PIECE_LEN, (piece + 1) * METADATA_PIECE_LEN))
		else 
			this.metaDataExDataReject(piece)

	}

	pMetaDataExData(args) {

		if(this.fileMetaData.metaInfoRaw)
			return

		let numPieces
		let { piece, total_size, data } = args

		this.total_size = total_size
		numPieces = Math.ceil(total_size / METADATA_PIECE_LEN)

		this.metaInfoPieces.set(piece, data)

		if(total_size && this.metaInfoPieces.size * METADATA_PIECE_LEN < total_size) {

			let piecesLeft = Array.from((new NSet([...Array(numPieces).keys()])).difference(new NSet(this.metaInfoPieces.keys())))
			this.metaDataExRequest(piecesLeft[0])

		} else {

			let buf = new Buffer(0)

			for (var index of [...Array(numPieces).keys()])
				buf = Buffer.concat([buf, this.metaInfoPieces.get(index)])

			let hash = crypto.createHash('sha1').update(buf).digest('hex')

			if(hash == this.fileMetaData.infoHash.toString('hex')) {

				this.emit('got_meta_data', buf)

			} else {

				//this.metaInfoPieces.clear()
				//this.init()

			}

		}

	}

	pMetaDataExReject(args) {

		let {piece} = args

	}

	metaDataExRequest(index) {
		 
		let reqMsg = benEncode({'msg_type': 0, 'piece': index })
		this.push(this._makeMsg([EXTENDED_MSG_TYPE, this.supportedExtensions['ut_metadata']], reqMsg))

	}

	metaDataExData(index, data) {

		let dataMsg = benEncode({'msg_type': 1, 'piece': index, 'total_size': this.file.metaInfoSize})
		this.push(this._makeMsg([EXTENDED_MSG_TYPE, this.supportedExtensions['ut_metadata']], dataMsg, data))

	}

	metaDataExDataReject(index) {

		let rejectMsg = benEncode({'msg_type': 2, 'piece': index})
		this.push(this._makeMsg([EXTENDED_MSG_TYPE, this.supportedExtensions['ut_metadata']], rejectMsg))

	}

}

module.exports = {
	UTMetaDataEx : UTMetaDataEx
}