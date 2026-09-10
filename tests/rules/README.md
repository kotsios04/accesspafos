# Security rules tests

These run against the Firestore emulator, not against a real project.

```bash
# terminal 1
firebase emulators:start --only firestore

# terminal 2
npm run test:rules
```

They are excluded from `npm test` because they need the emulator running.
Run them before any change to `firestore.rules` reaches production: the
project's central claim — that no client can write authoritative accessibility
data — is only as true as this file says it is.
