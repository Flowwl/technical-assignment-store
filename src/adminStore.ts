import { lazy } from "./utils/lazy";
import { Restrict, Store } from "./store";
import { UserStore } from "./userStore";



export class AdminStore extends Store {
  @Restrict("r")
  public user: UserStore;
  @Restrict()
  name: string = "John Doe";
  @Restrict("rw")
  getCredentials = lazy(() => {
    const credentialStore = new Store();
    credentialStore.writeEntries({ username: "user1" });
    return credentialStore;
  });

  constructor(user: UserStore) {
    super();
    this.defaultPolicy = "none";
    this.user = user;
  }
}
