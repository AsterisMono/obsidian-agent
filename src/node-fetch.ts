import http from 'node:http';
import https from 'node:https';

export async function nodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS requests are supported.');
  }
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const client = transport.request(url, { method: request.method, headers }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else if (value !== undefined) responseHeaders.set(name, value);
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          incoming.on('data', (chunk: Buffer) => {
            controller.enqueue(chunk);
          });
          incoming.on('end', () => {
            controller.close();
          });
          incoming.on('error', (error: Error) => {
            controller.error(error);
          });
        },
        cancel() {
          incoming.destroy();
        },
      });
      resolve(
        new Response([204, 205, 304].includes(incoming.statusCode ?? 500) ? null : stream, {
          status: incoming.statusCode ?? 500,
          statusText: incoming.statusMessage,
          headers: responseHeaders,
        }),
      );
    });
    client.on('error', reject);
    request.signal.addEventListener('abort', () => client.destroy(new Error('Request aborted.')), {
      once: true,
    });
    client.end(body);
  });
}
