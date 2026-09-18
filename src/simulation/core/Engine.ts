import * as THREE from 'three/webgpu';

export class Engine {
  public renderer: THREE.WebGPURenderer;
  public timer: THREE.Timer;
  /** True when the live backend is WebGPU (not the WebGL2 fallback). */
  public isWebGPU = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);

    // Ensure the canvas is sized by CSS so physical resizing is fluid
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';

    // Use default shadow map (PCF) as VSM support in WebGPU/NodeMaterial can be sensitive
    this.renderer.shadowMap.enabled = true;

    container.appendChild(this.renderer.domElement);
    this.timer = new THREE.Timer();
  }

  public async init() {
    try {
      await this.renderer.init();
      const backend = (this.renderer as any).backend;
      this.isWebGPU = !!backend?.isWebGPUBackend;

      if (!this.isWebGPU) {
        console.warn(
          '[Engine] WebGPU unavailable — WebGL2 fallback. Characters use CPU movement + bind-pose (no storage shaders). Enable WebGPU in Chrome/Edge for full animation.'
        );
      } else {
        console.info('[Engine] WebGPU backend ready.');
      }
    } catch (e) {
      console.error('WebGPU initialization failed:', e);
      this.isWebGPU = false;
    }
  }

  public onResize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
  }

  public render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.renderer.render(scene, camera);
  }

  public dispose() {
    this.renderer.dispose();
  }
}
