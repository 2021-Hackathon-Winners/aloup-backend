import WebSocket from 'ws';
import { Db, ObjectId } from 'mongodb';
import fs from 'fs';
import { OAuth2Client } from 'google-auth-library';

const config = JSON.parse(fs.readFileSync("config.json").toString())
const gClient = new OAuth2Client(config.CLIENT_ID)

interface IData {
    [ key: string ]: () => void;
}

// Game Definitions
const ROOM_WIDTH = 100
const STAGE_HEIGHT = 100
const MIN_MOVEMENT = STAGE_HEIGHT * 0.1

enum StageType {
    WEIGHTED = "Weighted",
    SEESAW = "Seesaw",
    TILES = "Tiles"
}

type WSData = {websocket: WebSocket, requestId: string}

type User = {
    name: string,
    wsData: WSData
}

type Position = {
    x: number,
    y: number
}

type Game = {
    name: string,
    stages: StageType[],
    dict: [string, string][]
}

interface Sessions {
    [key: string]: {
        gm: User,
        users: User[],
        rooms: string[],
        game: Game,
        stageData: StageData[]
    }
}
type Room = {
    users: [User, Position][],
    session: string,
    currentStage: number
}
interface Rooms {
    [key: string]: Room
}
interface StageData {
    stageName: string,
    term: string,
    options: string[],
    correctOption: number
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

function getShuffledArr<T>(arr: T[]) {
    const newArr = arr.slice()
    for (let i = newArr.length - 1; i > 0; i--) {
        const rand = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[rand]] = [newArr[rand], newArr[i]];
    }
    return newArr
};

const getStageData = (vocab: [string, string][], stages: StageType[]) => {
    const stageData: StageData[] = []
    vocab = getShuffledArr(vocab)
    let i = 0
    for (let stage of stages) {
        const correctOption = Math.floor(Math.random() * 4)
        const options = [vocab[(i + 1) % vocab.length][1], vocab[(i + 2) % vocab.length][1], vocab[(i + 3) % vocab.length][1]]
        options.splice(correctOption, 0, vocab[i % vocab.length][1])
        stageData.push({
            stageName: stage,
            term: vocab[i % vocab.length][0],
            correctOption,
            options: options
        })
        i++;
    }
    return stageData
}

const sanitizeRoom = (room: Room, id: string) => {
    const newRoom: any = {}
    newRoom.id = id
    newRoom.session = room.session
    newRoom.currentStage = room.currentStage
    newRoom.users = [] as [[string], Position][]
    for (let i = 0; i < room.users.length; i++) {
        const user = [{name: room.users[i][0].name}, room.users[i][1]]
        newRoom.users.push(user)
    }
    return newRoom
}

const detectIfStageComplete = (room: string) => {
    const r = rooms[room]
    const userPositions = r.users.map(u => u[1])
    const stageData = sessions[r.session].stageData[r.currentStage - 1]

    const basex = (r.currentStage - 1) * STAGE_HEIGHT

    switch (stageData.stageName) {
        case StageType.WEIGHTED:
            for (let pos of userPositions) {
                if (pos.x < MIN_MOVEMENT + basex) {
                    return false
                }
                if (stageData.correctOption % 2 == 0) {
                    if (pos.y < ROOM_WIDTH / 2) {
                        return false
                    }
                } else {
                    if (pos.y > ROOM_WIDTH / 2) {
                        return false
                    }
                }
            }
            return true
        case StageType.SEESAW:
            let num = 0
            for (let pos of userPositions) {
                if (pos.x < MIN_MOVEMENT + basex) {
                    return false
                }
                if (stageData.correctOption % 2 == 0) {
                    if (pos.y > ROOM_WIDTH / 2) {
                        num += 1
                    }
                } else {
                    if (pos.y < ROOM_WIDTH / 2) {
                        num += 1
                    }
                }
            }
            if (num < r.users.length / 2) {
                return false
            }
            return true
        case StageType.TILES:
            for (let pos of userPositions) {
                if (stageData.correctOption === 0) {
                    if (pos.y > ROOM_WIDTH / 2 || pos.x < (basex + STAGE_HEIGHT / 2)) {
                        return false
                    }
                } else if (stageData.correctOption === 1) {
                    if (pos.y < ROOM_WIDTH / 2 || pos.x < (basex + STAGE_HEIGHT / 2)) {
                        return false
                    }
                } else if (stageData.correctOption === 2) {
                    if (pos.y > ROOM_WIDTH / 2 || pos.x > (basex + STAGE_HEIGHT / 2)) {
                        return false
                    }
                } else if (stageData.correctOption === 3) {
                    if (pos.y < ROOM_WIDTH / 2 || pos.x > (basex + STAGE_HEIGHT / 2)) {
                        return false
                    }
                }
            }
            return true
    }
}

export default async (message: any, ws: WebSocket, db: Db) => {
    console.log(message)
    const send = (m: any, wss?: WSData) => {

        if (wss?.requestId) {
            m.responseId = wss.requestId
        } else {
            m.responseId = message.requestId
        }
        if (wss) {
            wss.websocket.send(JSON.stringify(m))
        } else {
            ws.send(JSON.stringify(m))
        }
        console.log(m)
    }
    const sendSuccess = () => send({success: true})
    const sendError = (errmsg: string) => send({error: errmsg})
    const funSendError = (errmsg: string) => (e: any) => {sendError(errmsg); console.log(e)}
    const sendWrapArray = (items: any[]) => send({items})

    const updateRoom = (room: string) => {
        rooms[room].users.forEach(user => {
            send(sanitizeRoom(rooms[room], room), user[0].wsData)
        })
    }

    const sendWinToSession = (session: string, room: string) => {
        const users = rooms[room].users.map(user => user[0].name)
        send({win: true, users}, sessions[session].gm.wsData)
        sessions[session].users.forEach(user => {
            send({win: true, users}, user.wsData)
        })
    }

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

    if (message.request === "joinSession") {
        try {
            const session = sessions[message.code]
            if (session.users.some(user => user.name === message.nickname)) {
                sendError('nat')
                return
            }
            session.users.push({name: message.nickname, wsData: {websocket: ws, requestId: message.requestId}})
            send({success: true, stageData: session.stageData})
            send({code: message.code, name: session.game.name, users: session.users.map(user => user.name)}, sessions[message.code].gm.wsData)
        } catch (error) {
            console.log(error)
            sendError('nac')
        }
        return
    }

    if (message.request === "updatePosition") {
        try {
            const room = rooms[message.roomID]
            const xval = room.currentStage * STAGE_HEIGHT
            if (message.position.x > xval) {
                message.position.x = xval
            } else if (message.position.x < 0) {
                message.position.x = 0
            }

            if (message.position.y > ROOM_WIDTH) {
                message.position.y = ROOM_WIDTH
            } else if (message.position.y < 0) {
                message.position.y = 0
            }

            const user = rooms[message.roomID].users.findIndex(user => user[0].name === message.nickname)
            rooms[message.roomID].users[user][1] = message.position

            if (detectIfStageComplete(message.roomID)) {
                rooms[message.roomID].currentStage += 1
            }

            updateRoom(message.roomID)

            if (room.currentStage > sessions[room.session].stageData.length) {
                sendWinToSession(room.session, message.roomID)
            }
            
        } catch (error) {
            console.log(error)
            sendError('nar')
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
                gm: {name: email, wsData: {websocket: ws, requestId: message.requestId}},
                users: [],
                rooms: [] as string[],
                game,
                stageData: getStageData(game.dict, game.stages)
            }
            send({code, name: game.name})
        },
        setupTeams: () => {
            const session = sessions[message.code]
            const numberOfTeams = Math.ceil(session.users.length / message.number)
            let roomIDS = []
            for (let i = 0; i < numberOfTeams; i++) {
                const roomID = uuidv4()
                rooms[roomID] = {users: [], session: message.code, currentStage: 1}
                roomIDS.push(roomID)
            }
            for (let i = 0; i < session.users.length; i++) {
                const randY = Math.round(Math.random() * ROOM_WIDTH)
                rooms[roomIDS[i % numberOfTeams]].users.push([session.users[i], {x: 0, y: randY}])
            }
            sessions[message.code].rooms = roomIDS
            
            const teams = [] as string[][]
            for (let roomID of roomIDS) {
                teams.push(rooms[roomID].users.map(user => user[0].name))
                updateRoom(roomID)
            }
            send({teams})
        },
        startGame: () => {
            const session = sessions[message.code]
            session.users.forEach(user => {
                send({start: true}, user.wsData)
            })
            sendSuccess()
        }
    }

    try {
        functions[message.request]()
    } catch (error) {
        console.log(error)
        sendError('nvf')
    }
}