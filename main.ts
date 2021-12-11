console.log("Starting aloup server...")

import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import responder from './responder';
import { Binary, MongoClient } from 'mongodb';
import url from 'url'
import path from 'path'


const config = JSON.parse(fs.readFileSync("config.json").toString())

const client = new MongoClient((process.env.NODE_ENV === "production") ? config.mongodb : "mongodb://localhost:27017", { useUnifiedTopology: true })

let handleImage = (res: any, image: string) => {}

const filesystem = (req: any, res: any) => {
  console.log(`${req.method} ${req.url}`);

  // parse URL
  const parsedUrl = url.parse(req.url ? req.url as string : "");
  // extract URL path
  let pathname = `./aloup-frontend/build${parsedUrl.pathname}`;
  if (parsedUrl.pathname?.startsWith("/userimages")) {
    handleImage(res, parsedUrl.pathname.substr(12))
    return
  }
  // based on the URL path, extract the file extension. e.g. .js, .doc, ...
  const ext = path.parse(pathname).ext;
  // maps file extention to MIME typere
  const map: {[key: string]: string} = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword'
  };

  fs.exists(pathname, function (exist) {
    if(!exist) {
      // if the file is not found, return 404
      res.statusCode = 404;
      res.end(`File ${pathname} not found!`);
      return;
    }

    // if is a directory search for index file matching the extention
    if (fs.statSync(pathname).isDirectory()) pathname += '/index.html';

    // read file from file system
    fs.readFile(pathname, function(err, data){
      if(err){
        res.statusCode = 500;
        res.end(`Error getting the file: ${err}.`);
      } else {
        // if the file is found, set Content-type and send data
        res.setHeader('Content-type', map[ext] || 'text/html' );
        res.end(data);
      }
    });
  });
}

const realserver = http.createServer(filesystem)

const wss = new WebSocket.Server({server: realserver})

wss.on('connection', function connection(ws: any) {
    (ws as any).isAlive = true;
    ws.on('pong', () => {(ws as any).isAlive = true});

    ws.on('message', function incoming(message: any) {

        const json = JSON.parse((message as string))

        responder(json, ws, client.db("aloup"))
    })
});

// Alive listener
const interval = setInterval(function ping() {
wss.clients.forEach(function each(ws: any) {
    if ((ws as any).isAlive === false) return ws.terminate();

    (ws as any).isAlive = false;
    ws.ping(() => {(ws as any).isAlive = true;});
});
}, 30000);

client.connect(() => {
    const port = (process.env.NODE_ENV === "production") ? (8080) : 80
    realserver.listen(port)

    const db = client.db("aloup");
    
    const auth = db.collection("auth")
    auth.createIndex({"uuid": 1}, {unique: true})

    const images = db.collection("images")
    handleImage = async (res: any, image: string) => {
      const data = await images.findOne({filename: image})
      if (data) {
        res.setHeader('Content-type', 'image/jpeg');
        res.end((data.data as Binary).buffer)
      } else {
        res.statusCode = 404;
        res.end(`File ${image} not found!`);
      }
    }

    console.log(`WebSocket server listening on port ${port}...`)
})
