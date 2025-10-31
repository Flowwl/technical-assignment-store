import { JSONArray, JSONObject, JSONPrimitive } from "./utils/json-types";

export type Permission = "r" | "w" | "rw" | "none";

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


export function Restrict(...params: Permission[]): any {
  return function (target: any, propertyKey: string | symbol) {
    const key = String(propertyKey);

    const privateKey = Symbol(key);
    Object.defineProperty(target, key, {
      get() {
        return this[privateKey];
      },
      set(value: StoreValue) {
        this[privateKey] = value;

        if (!this.permissionsByKey) {
          this.permissionsByKey = {};
        }

        this.permissionsByKey[key] = params;
      },
      enumerable: true,
      configurable: true,
    });
  };
}

export class Store implements IStore {
  defaultPolicy: Permission = "rw";
  permissionsByKey: Record<string, Permission[]> = {};

  allowedToRead(key: string): boolean {
    return this.checkHasPermissionForKey(key, ["r", "rw"]);
  }

  allowedToWrite(key: string): boolean {
    return this.checkHasPermissionForKey(key, ["w", "rw"]);
  }

  read(path: string): StoreResult {
    if (!this.allowedToRead(path)) {
      throw new Error(`Not allowed to read for path ${path}`);
    }

    const descriptor = this.getDescriptor(path);
    return descriptor?.get?.call(this);
  }

  write(path: string, value: StoreValue): StoreValue {
    if (!this.allowedToWrite(path)) {
      throw new Error(`Not allowed to write for path ${path}`);
    }

    const descriptor = this.getDescriptor(path);
    descriptor?.set?.call(this, value);
    return descriptor?.get?.call(this);
  }

  writeEntries(entries: JSONObject): void {
    Object.entries(entries).forEach(([key, value]) => {
      this.write(key, value);
    })
  }

  entries(): JSONObject {
    const result: JSONObject = {};
    const descriptors = this.getAllDescriptors();
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (this.allowedToRead(key)) {
        result[key] = descriptor.value;
      }
    }
    return result;
  }

  private checkHasPermissionForKey(key: string, permissions: Permission[]): boolean {
    const keyPerms: Permission[] = this.permissionsByKey[key] ?? [];
    if (this.hasKey(key) && keyPerms) {
      return keyPerms.some((keyPerm) => permissions.includes(keyPerm));
    }

    if (this.defaultPolicy === "none") {
      return false;
    }

    return permissions.includes(this.defaultPolicy);
  }

  private hasKey(key: string): boolean {
    return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), key) !== undefined;
  }

  private getAllDescriptors(): ReturnType<typeof Object.getOwnPropertyDescriptors> {
    return Object.getOwnPropertyDescriptors(Object.getPrototypeOf(this));
  }

  private getDescriptor(key: string): PropertyDescriptor | null {
    return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), key) || null;
  }
}
