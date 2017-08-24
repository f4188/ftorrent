
//EXTENDED_MSG_TYPE
const EXTENDED_MSG_TYPE = 20 
const METADATAEX_MSG_TYPE = 1
//PPEEREX_MSG_TYPE

benEncode = require('bencode').encode

/*
	Peer = MetaDataExchange(PeerExchange(Peer))
	UT_METADATA(UT_PEEREX(Peer))
	ut_metadata(ut_peerex(Peer))
	MetaData(PeerEx(Peer))
*/

let MetaData = (SuperClass) => class MetaDataEx extends SuperClass {

	constructor(args...) {
		super(args)
		this.recvExtensions['ut_metadata'] = [PEEREX_MSG_TYPE]
		this.msgHandler[EXTENDED_MSG_TYPE][METADATAEX_MSG_TYPE] = this.router
		this.metaInfoPieces = []
	}

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

		if(this.file.info != null)
			this.metaDataExData(piece, this.file.metaInfoRaw.slice(piece * (2 ** 16), (piece + 1) * 2 ** 16))
		else 
			this.metaDataExDataReject(piece)

	}

	pMetaDataExData(args) {

		let { piece, total_size, data } = args

		this.metaInfoPieces.push({'piece': piece, 'data': data})

		//if(this.metaInfoPieces.map(infoPieces => infoPieces.data.length).reduce( (a,b) => a + b, 0 )
		//	== total_size) {
			//this.file.info = this.metaInfoPieces.map(infoPieces => infoPieces.data).reduce( (a,b) => Buffer.concat([a,b]), Buffer.alloc(0))
			//check hash
		//}

	}

	pMetaDataExReject(args) {

		let {piece} = args

	}

	metaDataExRequest(index) {

		let reqMsg = benEncode({'msg_type': 0, 'piece': index })
		this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], reqMsg))

	}

	metaDataExData(index, data) {

		let dataMsg = benEncode({'msg_type': 1, 'piece': index, 'total_size': this.file.metaInfoSize})
		this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], dataMsg, data))

	}

	metaDataExDataReject(index) {
		
		let rejectMsg = benEncode({'msg_type': 2, 'piece': index})
		this.push(this.makeMsg([EXTENDED_MSG_TYPE, PMETADATAEX_MSG_TYPE], rejectMsg))

	}

}

module.exports = {
	MetaData : MetaData
}