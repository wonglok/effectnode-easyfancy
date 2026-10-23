# Source credits

- [React Three Fiber](https://github.com/pmndrs/react-three-fiber), Poimandres, MIT.
- [Glyph](https://github.com/pmndrs/glyph), Justin Walsh and contributors, MIT. Used for Slug typography, shaping, metrics, and hero outlines.
- [WebGPU Glass](https://github.com/ektogamat/webgpu-glass-drei), Anderson Mancini. `glass/transmissionNodes.js`, `glass/TransmissionPhysicalLightingModel.js`, and `glass/transmissionBackdrop.js` originate in that repository. `glass/create-glass.js` adapts its material setup for one shared scene material. The backdrop manager additionally releases its render targets when its last material is removed. No license file was present in the referenced upstream repository at retrieval.
- [three-pinata](https://github.com/dgreenheck/three-pinata), David Greenheck. Fracture reference only. No source copied. The local implementation constructs 2D Voronoi cells and clips Glyph contours with polygon-clipping.
- [polygon-clipping](https://github.com/mfogel/polygon-clipping), MIT, used to retain letter holes and disconnected fragments.
- [Studio Small 09](https://polyhaven.com/a/studio_small_09), Sergej Majboroda / Poly Haven, CC0. The bundled 1K HDR is the same studio environment used by Anderson's reference.
- [1975 glass reference](https://codesandbox.io/p/sandbox/1975-glas-refraction-forked-zdpqx7), visual and bevel-setting reference. No GLSL material code is copied into this WebGPU project.
- [Space Grotesk](https://github.com/google/fonts/tree/main/ofl/spacegrotesk), Florian Karsten, SIL Open Font License. Bundled at weight 600 with Glyph outlines. License: `assets/SpaceGrotesk-OFL.txt`.
- [IBM Plex Mono](https://github.com/google/fonts/tree/main/ofl/ibmplexmono), IBM, SIL Open Font License. Bundled Regular as a Glyph Slug font. License: `assets/IBMPlexMono-OFL.txt`.
- [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope), SIL Open Font License. Weight 600 baked with Glyph outlines. License: `assets/Manrope-OFL.txt`.
