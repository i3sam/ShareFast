import { HttpError } from './http.js';

export class Router {
  #routes = [];

  on(method, pattern, handler) {
    const names = [];
    const source = pattern.replace(/:(\w+)/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
    this.#routes.push({ method, regex: new RegExp(`^${source}$`), names, handler });
    return this;
  }

  match(method, pathname) {
    let pathExists = false;

    for (const route of this.#routes) {
      const match = route.regex.exec(pathname);
      if (!match) continue;

      pathExists = true;
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) continue;

      const params = {};
      route.names.forEach((name, index) => {
        params[name] = decodeParam(match[index + 1]);
      });
      return { handler: route.handler, params };
    }

    if (pathExists) throw new HttpError(405, 'Method not allowed.');
    throw new HttpError(404, 'Not found.');
  }
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Malformed URL.');
  }
}
