// The transport package ships no type declarations, and this side-effect import
// is how its custom elements register themselves.
//
// Its own file rather than a line in `app.d.ts`: that one ends in `export {}`,
// which makes it a module, and `declare module` inside a module is an
// *augmentation* of something that already exists. An ambient declaration for a
// package with no types has to live in a file that is not a module — which is
// why the same line there changed nothing.
declare module '@le-space/libp2p-webrtc-qr/elements';
