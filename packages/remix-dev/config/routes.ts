import { resolve, win32 } from "node:path";
import * as v from "valibot";
import pick from "lodash/pick";

import invariant from "../invariant";

let appDirectory: string;

export function setAppDirectory(directory: string) {
  appDirectory = directory;
}

/**
 * Provides the absolute path to the app directory, for use within `routes.ts`.
 * This is designed to support resolving file system routes.
 */
export function getAppDirectory() {
  invariant(appDirectory);
  return appDirectory;
}

export interface RouteManifestEntry {
  /**
   * The path this route uses to match on the URL pathname.
   */
  path?: string;

  /**
   * Should be `true` if it is an index route. This disallows child routes.
   */
  index?: boolean;

  /**
   * Should be `true` if the `path` is case-sensitive. Defaults to `false`.
   */
  caseSensitive?: boolean;

  /**
   * The unique id for this route, named like its `file` but without the
   * extension. So `app/routes/gists/$username.tsx` will have an `id` of
   * `routes/gists/$username`.
   */
  id: string;

  /**
   * The unique `id` for this route's parent route, if there is one.
   */
  parentId?: string;

  /**
   * The path to the entry point for this route, relative to
   * `config.appDirectory`.
   */
  file: string;
}

export interface RouteManifest {
  [routeId: string]: RouteManifestEntry;
}

/**
 * Configuration for an individual route, for use within `routes.ts`. As a
 * convenience, route config entries can be created with the {@link route},
 * {@link index} and {@link layout} helper functions.
 */
export interface RouteConfigEntry {
  /**
   * The unique id for this route.
   */
  id?: string;

  /**
   * The path this route uses to match on the URL pathname.
   */
  path?: string;

  /**
   * Should be `true` if it is an index route. This disallows child routes.
   */
  index?: boolean;

  /**
   * Should be `true` if the `path` is case-sensitive. Defaults to `false`.
   */
  caseSensitive?: boolean;

  /**
   * The path to the entry point for this route, relative to
   * `config.appDirectory`.
   */
  file: string;

  /**
   * The child routes.
   */
  children?: RouteConfigEntry[];
}

export const routeConfigEntrySchema: v.BaseSchema<
  RouteConfigEntry,
  any,
  v.BaseIssue<unknown>
> = v.pipe(
  v.custom<RouteConfigEntry>((value) => {
    return !(
      typeof value === "object" &&
      value !== null &&
      "then" in value &&
      "catch" in value
    );
  }, "Invalid type: Expected object but received a promise. Did you forget to await?"),
  v.object({
    id: v.optional(v.string()),
    path: v.optional(v.string()),
    index: v.optional(v.boolean()),
    caseSensitive: v.optional(v.boolean()),
    file: v.string(),
    children: v.optional(v.array(v.lazy(() => routeConfigEntrySchema))),
  })
);

export const resolvedRouteConfigSchema = v.array(routeConfigEntrySchema);
type ResolvedRouteConfig = v.InferInput<typeof resolvedRouteConfigSchema>;

/**
 * Route config to be exported via the `routes` export within `routes.ts`.
 */
export type RouteConfig = ResolvedRouteConfig | Promise<ResolvedRouteConfig>;

export function validateRouteConfig({
  routeConfigFile,
  routeConfig,
}: {
  routeConfigFile: string;
  routeConfig: unknown;
}): { valid: false; message: string } | { valid: true } {
  if (!routeConfig) {
    return {
      valid: false,
      message: `No "routes" export defined in "${routeConfigFile}.`,
    };
  }

  if (!Array.isArray(routeConfig)) {
    return {
      valid: false,
      message: `Route config in "${routeConfigFile}" must be an array.`,
    };
  }

  let { issues } = v.safeParse(resolvedRouteConfigSchema, routeConfig);

  if (issues?.length) {
    let { root, nested } = v.flatten(issues);
    return {
      valid: false,
      message: [
        `Route config in "${routeConfigFile}" is invalid.`,
        root ? `${root}` : [],
        nested
          ? Object.entries(nested).map(
              ([path, message]) => `Path: routes.${path}\n${message}`
            )
          : [],
      ]
        .flat()
        .join("\n\n"),
    };
  }

  return { valid: true };
}

const createConfigRouteOptionKeys = [
  "id",
  "index",
  "caseSensitive",
] as const satisfies ReadonlyArray<keyof RouteConfigEntry>;
type CreateRouteOptions = Pick<
  RouteConfigEntry,
  typeof createConfigRouteOptionKeys[number]
>;
/**
 * Helper function for creating a route config entry, for use within
 * `routes.ts`.
 */
function route(
  path: string | null | undefined,
  file: string,
  children?: RouteConfigEntry[]
): RouteConfigEntry;
function route(
  path: string | null | undefined,
  file: string,
  options: CreateRouteOptions,
  children?: RouteConfigEntry[]
): RouteConfigEntry;
function route(
  path: string | null | undefined,
  file: string,
  optionsOrChildren: CreateRouteOptions | RouteConfigEntry[] | undefined,
  children?: RouteConfigEntry[]
): RouteConfigEntry {
  let options: CreateRouteOptions = {};

  if (Array.isArray(optionsOrChildren) || !optionsOrChildren) {
    children = optionsOrChildren;
  } else {
    options = optionsOrChildren;
  }

  return {
    file,
    children,
    path: path ?? undefined,
    ...pick(options, createConfigRouteOptionKeys),
  };
}

const createIndexOptionKeys = ["id"] as const satisfies ReadonlyArray<
  keyof RouteConfigEntry
>;
type CreateIndexOptions = Pick<
  RouteConfigEntry,
  typeof createIndexOptionKeys[number]
>;
/**
 * Helper function for creating a route config entry for an index route, for use
 * within `routes.ts`.
 */
function index(file: string, options?: CreateIndexOptions): RouteConfigEntry {
  return {
    file,
    index: true,
    ...pick(options, createIndexOptionKeys),
  };
}

const createLayoutOptionKeys = ["id"] as const satisfies ReadonlyArray<
  keyof RouteConfigEntry
>;
type CreateLayoutOptions = Pick<
  RouteConfigEntry,
  typeof createLayoutOptionKeys[number]
>;
/**
 * Helper function for creating a route config entry for a layout route, for use
 * within `routes.ts`.
 */
function layout(file: string, children?: RouteConfigEntry[]): RouteConfigEntry;
function layout(
  file: string,
  options: CreateLayoutOptions,
  children?: RouteConfigEntry[]
): RouteConfigEntry;
function layout(
  file: string,
  optionsOrChildren: CreateLayoutOptions | RouteConfigEntry[] | undefined,
  children?: RouteConfigEntry[]
): RouteConfigEntry {
  let options: CreateLayoutOptions = {};

  if (Array.isArray(optionsOrChildren) || !optionsOrChildren) {
    children = optionsOrChildren;
  } else {
    options = optionsOrChildren;
  }

  return {
    file,
    children,
    ...pick(options, createLayoutOptionKeys),
  };
}

/**
 * Helper function for adding a path prefix to a set of routes without needing
 * to introduce a parent route file, for use within `routes.ts`.
 */
function prefix(
  prefixPath: string,
  routes: RouteConfigEntry[]
): RouteConfigEntry[] {
  return routes.map((route) => {
    if (route.index || typeof route.path === "string") {
      return {
        ...route,
        path: route.path ? joinRoutePaths(prefixPath, route.path) : prefixPath,
        children: route.children,
      };
    } else if (route.children) {
      return {
        ...route,
        children: prefix(prefixPath, route.children),
      };
    }
    return route;
  });
}

const helpers = { route, index, layout, prefix };
export { route, index, layout, prefix };
/**
 * Creates a set of route config helpers that resolve file paths relative to the
 * given directory, for use within `routes.ts`. This is designed to support
 * splitting route config into multiple files within different directories.
 */
export function relative(directory: string): typeof helpers {
  return {
    /**
     * Helper function for creating a route config entry, for use within
     * `routes.ts`. Note that this helper has been scoped, meaning that file
     * path will be resolved relative to the directory provided to the
     * `relative` call that created this helper.
     */
    route: (path, file, ...rest) => {
      return route(path, resolve(directory, file), ...(rest as any));
    },
    /**
     * Helper function for creating a route config entry for an index route, for
     * use within `routes.ts`. Note that this helper has been scoped, meaning
     * that file path will be resolved relative to the directory provided to the
     * `relative` call that created this helper.
     */
    index: (file, ...rest) => {
      return index(resolve(directory, file), ...(rest as any));
    },
    /**
     * Helper function for creating a route config entry for a layout route, for
     * use within `routes.ts`. Note that this helper has been scoped, meaning
     * that file path will be resolved relative to the directory provided to the
     * `relative` call that created this helper.
     */
    layout: (file, ...rest) => {
      return layout(resolve(directory, file), ...(rest as any));
    },

    // Passthrough of helper functions that don't need relative scoping so that
    // a complete API is still provided.
    prefix,
  };
}

export function configRoutesToRouteManifest(
  routes: RouteConfigEntry[],
  rootId = "root"
): RouteManifest {
  let routeManifest: RouteManifest = {};

  function walk(route: RouteConfigEntry, parentId: string) {
    let id = route.id || createRouteId(route.file);
    let manifestItem: RouteManifestEntry = {
      id,
      parentId,
      file: route.file,
      path: route.path,
      index: route.index,
      caseSensitive: route.caseSensitive,
    };

    if (routeManifest.hasOwnProperty(id)) {
      throw new Error(
        `Unable to define routes with duplicate route id: "${id}"`
      );
    }
    routeManifest[id] = manifestItem;

    if (route.children) {
      for (let child of route.children) {
        walk(child, id);
      }
    }
  }

  for (let route of routes) {
    walk(route, rootId);
  }

  return routeManifest;
}

function joinRoutePaths(path1: string, path2: string): string {
  return [
    path1.replace(/\/+$/, ""), // Remove trailing slashes
    path2.replace(/^\/+/, ""), // Remove leading slashes
  ].join("/");
}

export interface DefineRouteOptions {
  /**
   * Should be `true` if the route `path` is case-sensitive. Defaults to
   * `false`.
   */
  caseSensitive?: boolean;

  /**
   * Should be `true` if this is an index route that does not allow child routes.
   */
  index?: boolean;

  /**
   * An optional unique id string for this route. Use this if you need to aggregate
   * two or more routes with the same route file.
   */
  id?: string;
}

interface DefineRouteChildren {
  (): void;
}

/**
 * A function for defining a route that is passed as the argument to the
 * `defineRoutes` callback.
 *
 * Calls to this function are designed to be nested, using the `children`
 * callback argument.
 *
 *   defineRoutes(route => {
 *     route('/', 'pages/layout', () => {
 *       route('react-router', 'pages/react-router');
 *       route('reach-ui', 'pages/reach-ui');
 *     });
 *   });
 */
export interface DefineRouteFunction {
  (
    /**
     * The path this route uses to match the URL pathname.
     */
    path: string | undefined,

    /**
     * The path to the file that exports the React component rendered by this
     * route as its default export, relative to the `app` directory.
     */
    file: string,

    /**
     * Options for defining routes, or a function for defining child routes.
     */
    optionsOrChildren?: DefineRouteOptions | DefineRouteChildren,

    /**
     * A function for defining child routes.
     */
    children?: DefineRouteChildren
  ): void;
}

export type DefineRoutesFunction = typeof defineRoutes;

/**
 * A function for defining routes programmatically, instead of using the
 * filesystem convention.
 */
export function defineRoutes(
  callback: (defineRoute: DefineRouteFunction) => void
): RouteManifest {
  let routes: RouteManifest = Object.create(null);
  let parentRoutes: RouteManifestEntry[] = [];
  let alreadyReturned = false;

  let defineRoute: DefineRouteFunction = (
    path,
    file,
    optionsOrChildren,
    children
  ) => {
    if (alreadyReturned) {
      throw new Error(
        "You tried to define routes asynchronously but started defining " +
          "routes before the async work was done. Please await all async " +
          "data before calling `defineRoutes()`"
      );
    }

    let options: DefineRouteOptions;
    if (typeof optionsOrChildren === "function") {
      // route(path, file, children)
      options = {};
      children = optionsOrChildren;
    } else {
      // route(path, file, options, children)
      // route(path, file, options)
      options = optionsOrChildren || {};
    }

    let route: RouteManifestEntry = {
      path: path ? path : undefined,
      index: options.index ? true : undefined,
      caseSensitive: options.caseSensitive ? true : undefined,
      id: options.id || createRouteId(file),
      parentId:
        parentRoutes.length > 0
          ? parentRoutes[parentRoutes.length - 1].id
          : "root",
      file,
    };

    if (route.id in routes) {
      throw new Error(
        `Unable to define routes with duplicate route id: "${route.id}"`
      );
    }

    routes[route.id] = route;

    if (children) {
      parentRoutes.push(route);
      children();
      parentRoutes.pop();
    }
  };

  callback(defineRoute);

  alreadyReturned = true;

  return routes;
}

export function createRouteId(file: string) {
  return normalizeSlashes(stripFileExtension(file));
}

export function normalizeSlashes(file: string) {
  return file.split(win32.sep).join("/");
}

export function stripFileExtension(file: string) {
  return file.replace(/\.[a-z0-9]+$/i, "");
}
