import net from 'net';
import iconv from 'iconv-lite';

const D3_HOST = process.env.D3_HOST || 'devhdrd301';
const D3_PORT = parseInt(process.env.D3_PORT) || 9001;
const D3_TIMEOUT = parseInt(process.env.D3_TIMEOUT) || 180000;

/**
 * Send a query to the D3 database server via raw TCP socket.
 * Protocol: sends "GET /?{queryString}", receives Windows-1252 encoded response.
 * Strips "xmlserver 3" prefix from response.
 *
 * @param {string} queryString - The URL-encoded query string (without leading ?)
 * @returns {Promise<string>} The raw response string from D3
 */
export async function d3Query(queryString) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = new net.Socket();

    socket.setTimeout(D3_TIMEOUT);

    socket.connect(D3_PORT, D3_HOST, () => {
      const request = `GET /?${queryString}`;
      socket.write(Buffer.from(request, 'ascii'));
    });

    socket.on('data', (data) => {
      chunks.push(data);
    });

    socket.on('end', () => {
      const buffer = Buffer.concat(chunks);
      // Decode from Windows-1252
      let response = iconv.decode(buffer, 'win1252');
      // Strip D3 prefix
      response = response.replace('xmlserver 3', '');
      resolve(response);
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('D3 socket timeout'));
    });

    socket.on('error', (err) => {
      socket.destroy();
      reject(new Error(`D3 socket error: ${err.message}`));
    });
  });
}

/**
 * Send a query with CName and Audit appended from session.
 * @param {string} queryString - Base query string
 * @param {object} session - Session object with cname and audit
 * @returns {Promise<string>}
 */
export async function d3QueryWithAuth(queryString, session) {
  const authParams = `&CName=${encodeURIComponent(session.cname)}&Audit=${encodeURIComponent(session.audit)}`;
  return d3Query(queryString + authParams);
}
