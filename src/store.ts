import { JSONArray, JSONObject, JSONPrimitive } from './utils/json-types';

export type Permission = 'r' | 'w' | 'rw' | 'none';

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;

  allowedToRead(key: string): boolean;

  allowedToWrite(key: string): boolean;

  read(path: string): StoreResult;

  write(path: string, value: StoreValue): StoreValue;

  writeEntries(entries: JSONObject): void;

  entries(): JSONObject;
}


export function Restrict(...params: Permission[]): (target: Store, propertyKey: string) => void {
  return function (target: Store, propertyKey: string): void {
    define(target, propertyKey, params);
  };
}

export class Store implements IStore {
  defaultPolicy: Permission = 'rw';
  permissionsByKey: Record<string, Permission[]> = {};

  allowedToRead(key: string): boolean {
    return this.checkHasPermissionForKey(key, ['r', 'rw']);
  }

  allowedToWrite(key: string): boolean {
    return this.checkHasPermissionForKey(key, ['w', 'rw']);
  }

  read(path: string): StoreResult {
    if (!this.allowedToRead(path)) {
      throw new Error(`Not allowed to read for path ${path}`);
    }
    const pathSegments = path.split(':');
    const descriptor = this.getDescriptor(pathSegments?.[0]);
    const rawValue = descriptor?.get?.call(this);
    if (pathSegments.length === 1) {
      return resolveValue(rawValue, this);
    }
    const resolvedValue = resolveValue(rawValue, this);
    if (isStore(resolvedValue)) {
      return resolvedValue.read(pathSegments.slice(1).join(':'));
    }
    return resolvedValue;
  }

  write(path: string, value: StoreValue): StoreValue {
    if (!this.allowedToWrite(path)) {
      throw new Error(`Not allowed to write for path ${path}`);
    }
    const pathSegments = path.split(':');
    define(this, pathSegments[0], this.getPermissionsForKey(pathSegments[0]));
    const descriptor = this.getDescriptor(pathSegments?.[0]);
    if (pathSegments.length === 1) {
      if (typeof value === 'object' && value !== null) {
        const newStore = new Store();
        newStore.writeEntries(value as JSONObject);
        descriptor?.set?.call(this, newStore);
        return descriptor?.get?.call(this);
      }

      descriptor?.set?.call(this, value);
      return descriptor?.get?.call(this);
    }

    const nextSegments = pathSegments.slice(1).join(':');
    const currentValue = descriptor?.get?.call(this);
    const resolvedValue = resolveValue(currentValue, this);
    if (isStore(resolvedValue)) {
      resolvedValue.write(nextSegments, value);
      return resolvedValue;
    }
    const newStore = new Store();
    descriptor?.set?.call(this, newStore);
    newStore.write(nextSegments, value);
    return newStore;
  }

  writeEntries(entries: JSONObject): void {
    Object.entries(entries).forEach(([key, value]) => {
      this.write(key, value);
    });
  }

  entries(): JSONObject {
    const result: JSONObject = {};
    const descriptors = this.getAllDescriptors();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      const val = descriptor.get?.call(this) ?? descriptor.value;
      if (isStore(val)) {
        result[key] = val.entries();
      } else if (this.allowedToRead(key)) {
        result[key] = val as JSONObject[string];
      }
    }
    return result;
  }

  checkHasPermissionForKey(key: string, permissions: Permission[]): boolean {
    const pathSegments = key.split(':');
    if (pathSegments.length > 1) {
      const firstKey = pathSegments[0];
      const value = this.getValueForKey(firstKey);
      if (value instanceof Store) {
        return value.checkHasPermissionForKey(pathSegments.slice(1).join(':'), permissions);
      }
    }

    const keyPerms = this.getPermissionsForKey(key);
    if (this.hasKey(key) && keyPerms.length > 0) {
      return keyPerms.some((keyPerm) => permissions.includes(keyPerm));
    }

    if (this.defaultPolicy === 'none') {
      return false;
    }

    return permissions.includes(this.defaultPolicy);
  }

  private hasKey(key: string): boolean {
    return this.getDescriptor(key) !== null;
  }

  private getDescriptor(key: string): PropertyDescriptor | null {
    // Walk the prototype chain to find any descriptor for the given key
    let current: unknown = this as unknown;
    while (current && current !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(current as object, key);
      if (desc) {
        return desc;
      }
      current = Object.getPrototypeOf(current as object);
    }
    return null;
  }

  private getAllDescriptors(): ReturnType<typeof Object.getOwnPropertyDescriptors> {
    return {
      ...Object.getOwnPropertyDescriptors(Object.getPrototypeOf(this)),
      ...Object.getOwnPropertyDescriptors(this),
    };
  }

  private getValueForKey(key: string): StoreResult {
   const value = getValue(this, key);
   return this.resolveLazyValue(value);

    function getValue(store: Store, key: string): StoreResult {
      const descriptor = store.getDescriptor(key);
      if (descriptor?.get) {
        return descriptor.get.call(store);
      }
      // @ts-expect-error - index access for dynamic key
      return store[key] as StoreResult;
    }
  }
  private resolveLazyValue(value: StoreResult): StoreResult {
    if (typeof value === 'function') {
      return (value as () => StoreResult).call(this);
    }
    return value;
  }

  private getPermissionsForKey(key: string): Permission[] {
    const perms = this.permissionsByKey[key];
    if (Array.isArray(perms)) {
      return perms as Permission[];
    }
    let proto: unknown = Object.getPrototypeOf(this);
    while (proto && proto !== Object.prototype) {
      const map = (proto as { permissionsByKey?: Record<string, Permission[]> }).permissionsByKey;
      const candidate = map?.[key];
      if (Array.isArray(candidate)) {
        return candidate;
      }
      proto = Object.getPrototypeOf(proto);
    }
    return [];
  }
}

function define(target: Store, propertyKey: string, params: Permission[] = []) {
  const key = String(propertyKey);
  const privateKey = Symbol(key);

  target.permissionsByKey = {
    ...(target.permissionsByKey || {}),
    [key]: params,
  };
  return Object.defineProperty(target, key, {
    get() {
      return this[privateKey];
    },
    set(value: StoreValue) {
      this[privateKey] = value;
    },
    enumerable: true,
    configurable: true,
  });
}

// --- Helpers (unit-testable) ---
function isStore(value: unknown): value is Store {
  return value instanceof Store;
}

function resolveValue(value: unknown, context: Store): StoreResult {
  if (typeof value === 'function') {
    return (value as () => StoreResult).call(context);
  }
  return value as StoreResult;
}
