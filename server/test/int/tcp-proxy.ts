import net from 'node:net';

export interface TcpProxy {
  /** Port the proxy listens on (stable across stop/start). */
  readonly port: number;
  /** Closes the listener and destroys every open connection: the target looks unreachable. */
  stop(): Promise<void>;
  /** Re-listens on the same port. */
  start(): Promise<void>;
}

/** In-test TCP forwarder (127.0.0.1 only) used to simulate a database outage and recovery. */
export async function createTcpProxy(target: { host: string; port: number }): Promise<TcpProxy> {
  const sockets = new Set<net.Socket>();
  let server: net.Server | null = null;
  let port = 0;

  const track = (s: net.Socket): void => {
    sockets.add(s);
    s.on('error', () => undefined);
    s.on('close', () => sockets.delete(s));
  };

  const listen = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const srv = net.createServer((client) => {
        track(client);
        const upstream = net.connect(target.port, target.host);
        track(upstream);
        client.pipe(upstream);
        upstream.pipe(client);
        client.on('close', () => upstream.destroy());
        upstream.on('close', () => client.destroy());
      });
      srv.once('error', reject);
      srv.listen(port, '127.0.0.1', () => {
        port = (srv.address() as net.AddressInfo).port;
        server = srv;
        resolve();
      });
    });

  const stop = async (): Promise<void> => {
    const srv = server;
    server = null;
    for (const s of sockets) s.destroy();
    if (srv !== null) await new Promise<void>((resolve) => srv.close(() => resolve()));
  };

  await listen();
  return {
    get port() {
      return port;
    },
    stop,
    start: async () => {
      if (server === null) await listen();
    },
  };
}
