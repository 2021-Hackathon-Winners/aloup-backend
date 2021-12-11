import WebSocket from 'ws';
import { Db, ObjectId } from 'mongodb';
import fs from 'fs';
import { OAuth2Client } from 'google-auth-library';

const config = JSON.parse(fs.readFileSync("config.json").toString())
const gClient = new OAuth2Client(config.CLIENT_ID)

interface IData {
    [ key: string ]: () => void;
}

interface Sessions {
    [key: string]: any
}

interface Rooms {
    [key: string]: any
}

const sessions: Sessions = {}
const rooms: Rooms = {}

export const uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
        return v.toString(16);
    });
}

const randomCode = () => {
    let str = ""
    for (let i = 0; i < 6; i++) {
        str += Math.floor(Math.random() * 10)
    }

    return str
}

export default async (message: any, ws: WebSocket, db: Db) => {
    console.log(message)
    const send = (m: any) => {
        console.log(m)
        m.responseId = message.requestId
        ws.send(JSON.stringify(m))
    }
    const sendSuccess = () => send({success: true})
    const sendError = (errmsg: string) => send({error: errmsg})
    const funSendError = (errmsg: string) => (e: any) => {sendError(errmsg); console.log(e)}
    const sendWrapArray = (items: any[]) => send({items})


    const auth = db.collection("auth")
    const users = db.collection("users")
    const games = db.collection("game")

    if (message.request === "auth") {
        try {
            const ticket = await gClient.verifyIdToken({idToken: message.token, audience: [config.CLIENT_ID]})

            const payload = ticket.getPayload()
            if (!payload) {
                sendError('cvg')
                return
            }
            const a = uuidv4()
            send({auth: a})
            auth.insertOne({uuid: a, email: payload.email})

            let user = await users.findOne({email: payload.email})
            if (user) {
                return
            }

            users.insertOne({
                email: payload.email,
                name: payload.name,
                pfp: payload.picture
            })
        } catch {
            sendError('cvg')
        }
        return
    }

    const isAuth = await auth.findOne({uuid: message.auth})
    let email: string
    if (!isAuth) {
        sendError('ena')
        return
    } else {
        email = isAuth.email
    }
    const user = await users.findOne({email})

    const functions: IData = {
        getSelf: () => send(user),
        getGames: () => games.find({user: email}).toArray().then(sendWrapArray).catch(funSendError('cgg')),
        makeGame: async () => {
            games.insertOne({name: message.name, stages: message.stages, dict: message.dict, user: email, uuid: uuidv4()})
            sendSuccess()
        },
        makeSession: async () => {
            const code = randomCode()
            const game = await games.findOne({uuid: message.game})
            sessions[code] = {
                gm: [email, ws],
                users: [],
                rooms: [],
                game
            }
            send({code, name: game.name})
        },
        joinSession: () => {
            try {
                const _ = sessions[message.code]
                
            } catch {
                sendError('nac')
            }
        }
    }

    try {
        functions[message.request]()
    } catch (error) {
        console.log(error)
        sendError('nvf')
    }
}