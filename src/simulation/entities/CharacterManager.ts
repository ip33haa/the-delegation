
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  atan,
  attribute, cos, float, Fn, If, instanceIndex, mat3,
  mat4, positionLocal, sin, storage, texture, uint, uniform, uv, vec3,
  vec4
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { getAllAgents, getAllCharacters } from '../../data/agents';
import { getActiveAgentSet } from '../../integration/store/teamStore';
import { AgentBehavior, AnimationName, ExpressionKey } from '../../types';
import { AgentStateBuffer } from '../behavior/AgentStateBuffer';
import { ExpressionBuffer } from '../behavior/ExpressionBuffer';
import { DRACO_LIB_PATH } from '../constants';
import { PoiManager } from '../world/PoiManager';

export class CharacterManager {
  private instanceCount = getAllAgents(getActiveAgentSet()).length + 1;
  private poiManager: PoiManager | null = null;

  /** When false, use InstancedBufferAttributes + CPU movement (WebGL2 fallback). */
  private useWebGPU = true;

  // Compute Buffers (GPU)
  private posAttribute: THREE.StorageInstancedBufferAttribute | null = null;
  private velAttribute: THREE.StorageInstancedBufferAttribute | null = null;
  private colorAttribute: THREE.InstancedBufferAttribute | null = null;
  private accessoryAttribute: THREE.InstancedBufferAttribute | null = null;
  private positionStorage: any;
  private velocityStorage: any;

  // WebGL-safe instance attributes (no storage() in shaders)
  private instancePosAttr: THREE.InstancedBufferAttribute | null = null;
  private instanceFacingAttr: THREE.InstancedBufferAttribute | null = null;
  private instanceAlphaAttr: THREE.InstancedBufferAttribute | null = null;
  private expressionAttr: THREE.InstancedBufferAttribute | null = null;

  // Agent state buffer (CPU+GPU): waypoint + behavior state per instance
  private agentStateBuffer: AgentStateBuffer | null = null;

  // Expression buffer (CPU+GPU): eye and mouth UV offsets per instance
  private expressionBuffer: ExpressionBuffer | null = null;

  // CPU-side mirror of GPU positions (updated via GPU readback each frame)
  private debugPosArray: Float32Array | null = null;

  // Track global time for animation resets (also drives the paused-safe shader uTime uniform)
  private currentTime = 0;
  private uTime = uniform(0);

  // Logic Nodes
  private computeNode: any;

  // Assets & Objects
  private instancedMeshes: THREE.Mesh[] = [];
  private meshData: { name: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] = [];

  // Animation Data
  private animationsMeta: { [key: string]: { offset: number; numFrames: number; duration: number; index: number } } = {};
  private bakedAnimationsBuffer: THREE.StorageBufferAttribute | null = null;
  private metaBuffer: THREE.StorageBufferAttribute | null = null;
  private numBones = 0;
  private headBoneIndex = -1;

  // Uniforms
  private uSpeed = uniform(0.015);

  public isLoaded = false;

  constructor(private scene: THREE.Scene) { }

  /** Call after Engine.init() — WebGL cannot compile storage()/compute character shaders. */
  public setUseWebGPU(enabled: boolean) {
    this.useWebGPU = enabled;
  }

  public setPoiManager(poiManager: PoiManager) {
    this.poiManager = poiManager;
  }

  public async load() {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_LIB_PATH);
    loader.setDRACOLoader(dracoLoader);
    try {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/character.glb`);
      const model = gltf.scene;

      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      const allMeshes: THREE.Mesh[] = [];
      model.traverse((child) => {
        if ((child as any).isMesh) {
          allMeshes.push(child as THREE.Mesh);
          if ((child as any).isSkinnedMesh) {
            skinnedMeshes.push(child as THREE.SkinnedMesh);
          }
        }
      });

      if (allMeshes.length === 0) {
        console.warn("CharacterManager: No meshes found.");
        return;
      }

      this.meshData = allMeshes.map(m => ({
        name: m.name,
        geometry: m.geometry,
        material: m.material as THREE.MeshStandardMaterial
      }));

      const firstSkinnedMesh = skinnedMeshes[0];
      if (firstSkinnedMesh) {
        this.numBones = firstSkinnedMesh.skeleton.bones.length;
        const headBone = firstSkinnedMesh.skeleton.bones.find(b => b.name.toLowerCase() === 'head');
        this.headBoneIndex = headBone ? firstSkinnedMesh.skeleton.bones.indexOf(headBone) : -1;
      }

      const animations = gltf.animations;
      const animNames = Object.values(AnimationName);
      const bakedDataList: Float32Array[] = [];
      const metaArray = new Float32Array(animNames.length * 4);
      let currentOffset = 0;

      animNames.forEach((name, i) => {
        let clip = animations.find(a => a.name === name);
        // Fallback for essential animations
        if (!clip) {
          if (name === AnimationName.IDLE) clip = animations[0];
          else clip = animations.find(a => a.name === AnimationName.IDLE) || animations[0];
        }

        const baked = this.bakeAnimation(firstSkinnedMesh, clip!, model);
        bakedDataList.push(baked.data);

        this.animationsMeta[name] = {
          offset: currentOffset,
          numFrames: baked.numFrames,
          duration: baked.duration,
          index: i
        };

        metaArray[i * 4 + 0] = currentOffset;
        metaArray[i * 4 + 1] = baked.numFrames;
        metaArray[i * 4 + 2] = baked.duration;
        metaArray[i * 4 + 3] = 0;

        currentOffset += baked.numFrames * this.numBones;
      });

      const totalSize = bakedDataList.reduce((acc, data) => acc + data.length, 0);
      const combinedData = new Float32Array(totalSize);
      let seek = 0;
      for (const data of bakedDataList) {
        combinedData.set(data, seek);
        seek += data.length;
      }

      // itemSize 4 (not 16): WebGL fallback cannot wrap mat4 strides; storage() still
      // indexes as mat4 via the explicit type + matrix count below.
      this.bakedAnimationsBuffer = new THREE.StorageBufferAttribute(combinedData, 4);
      this.metaBuffer = new THREE.StorageBufferAttribute(metaArray, 4);

      this.initInstances();
      this.isLoaded = true;
    } catch (err) {
      console.error("Failed to load character:", err);
    }
  }

  public setInstanceCount(count: number) {
    if (this.instanceCount === count) return;
    this.instanceCount = count;
    if (this.isLoaded) {
      this.cleanupInstances();
      this.initInstances();
    }
  }

  /**
   * Reads back the GPU position buffer to CPU.
   * Must be called after renderer.compute() each frame.
   * Returns the updated positions (1-frame GPU lag).
   */
  public async syncFromGPU(renderer: any): Promise<Float32Array | null> {
    if (!this.posAttribute) return null;
    if (!this.useWebGPU) {
      // CPU is authoritative on WebGL fallback.
      return this.debugPosArray;
    }
    try {
      const buffer = await renderer.getArrayBufferAsync(this.posAttribute);
      this.debugPosArray = new Float32Array(buffer);
      (this.posAttribute.array as Float32Array).set(this.debugPosArray);
    } catch {
      // WebGPU readback not available – fall back to stale data
    }
    return this.debugPosArray;
  }

  public update(delta: number, renderer: any) {
    this.currentTime += delta;
    this.uTime.value = this.currentTime;

    if (this.expressionBuffer) {
      this.expressionBuffer.update(delta);
    }

    if (!this.useWebGPU) {
      this.simulateMovementCPU(delta);
      this.syncWebGLInstanceAttrs();
      return;
    }

    if (this.computeNode) {
      renderer.compute(this.computeNode);
    }
  }

  private cleanupInstances() {
    for (const mesh of this.instancedMeshes) {
      this.scene.remove(mesh);
    }
    this.instancedMeshes = [];
    this.computeNode = null;
    this.expressionBuffer = null;
    this.instancePosAttr = null;
    this.instanceFacingAttr = null;
    this.instanceAlphaAttr = null;
    this.expressionAttr = null;
  }

  private initInstances() {
    if (this.meshData.length === 0) return;

    const posArray = new Float32Array(this.instanceCount * 4);
    const velArray = new Float32Array(this.instanceCount * 4);
    const colorArray = new Float32Array(this.instanceCount * 3);
    const accessoryArray = new Float32Array(this.instanceCount);

    const tempColor = new THREE.Color();
    const spawnRadius = 8; // Default spawn area

    const spawnPois = this.poiManager?.getFreePoisByPrefix('spawn') || [];
    let spawnIndex = 0;

    const agentsBuffer = []; // Temporary to store POIs for orientation

    const system = getActiveAgentSet();
    const allCharacters = getAllCharacters(system);

    for (let i = 0; i < this.instanceCount; i++) {
      const agentNode = allCharacters.find(a => a.index === i) || system.leadAgent;
      const colorOverride = agentNode.color;
      tempColor.set(colorOverride);

      if (i === system.user.index) {
        // Player spawns at (0,0,0)
        posArray[i * 4 + 0] = 0;
        posArray[i * 4 + 2] = 0;
        agentsBuffer[i] = null;
      } else {
        const poi = spawnPois[spawnIndex % spawnPois.length];
        if (poi) {
          this.poiManager?.occupy(poi.id, i);
          posArray[i * 4 + 0] = poi.position.x;
          posArray[i * 4 + 2] = poi.position.z;
          spawnIndex++;
          agentsBuffer[i] = poi;
        } else {
          posArray[i * 4 + 0] = (Math.random() - 0.5) * spawnRadius * 2;
          posArray[i * 4 + 2] = (Math.random() - 0.5) * spawnRadius * 2;
          agentsBuffer[i] = null;
        }
        posArray[i * 4 + 3] = 1;
        velArray[i * 4 + 0] = (Math.random() - 0.5) * 0.1;
        velArray[i * 4 + 2] = (Math.random() - 0.5) * 0.1;
      }

      colorArray[i * 3 + 0] = tempColor.r;
      colorArray[i * 3 + 1] = tempColor.g;
      colorArray[i * 3 + 2] = tempColor.b;

      // Accessory logic: 0=None, 1=Headphones, 2=Cap
      if (i === system.user.index) {
        accessoryArray[i] = 0;
      } else if (i === system.leadAgent.index) {
        accessoryArray[i] = 1;
      } else {
        accessoryArray[i] = 2;
      }
    }


    this.debugPosArray = new Float32Array(posArray);

    this.posAttribute = new THREE.StorageInstancedBufferAttribute(posArray, 4);
    this.velAttribute = new THREE.StorageInstancedBufferAttribute(velArray, 4);
    this.colorAttribute = new THREE.InstancedBufferAttribute(colorArray, 3);
    this.accessoryAttribute = new THREE.InstancedBufferAttribute(accessoryArray, 1);

    // setPBO(true): WebGL2 fallback must sample storage from the vertex shader via textures.
    this.positionStorage = storage(this.posAttribute, 'vec4', this.instanceCount).setPBO(true);
    this.velocityStorage = storage(this.velAttribute, 'vec4', this.instanceCount).setPBO(true);

    if (!this.useWebGPU) {
      const pos3 = new Float32Array(this.instanceCount * 3);
      const facing = new Float32Array(this.instanceCount * 3);
      const alpha = new Float32Array(this.instanceCount);
      for (let i = 0; i < this.instanceCount; i++) {
        pos3[i * 3] = posArray[i * 4];
        pos3[i * 3 + 1] = posArray[i * 4 + 1];
        pos3[i * 3 + 2] = posArray[i * 4 + 2];
        facing[i * 3 + 2] = 1;
        alpha[i] = 1;
      }
      this.instancePosAttr = new THREE.InstancedBufferAttribute(pos3, 3);
      this.instanceFacingAttr = new THREE.InstancedBufferAttribute(facing, 3);
      this.instanceAlphaAttr = new THREE.InstancedBufferAttribute(alpha, 1);
      this.expressionAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.instanceCount * 4), 4);
    }

    // Physics & state buffer — all start at mode 0 (IDLE)
    this.agentStateBuffer = new AgentStateBuffer(this.instanceCount);
    for (let i = 0; i < this.instanceCount; i++) {
      this.setPhysicsMode(i, AgentBehavior.IDLE);

      // Initial animation: start with a random negative time so they are out of sync
      const meta = this.animationsMeta[AnimationName.IDLE];
      if (meta) {
        this.agentStateBuffer.setAnimation(i, meta.index, true, -Math.random() * 10);
      }

      // APPLY POI ORIENTATION
      const poi = agentsBuffer[i];
      if (poi && (poi.id.includes('spawn') || poi.id.includes('sit'))) {
        this.setOrientation(i, poi.quaternion);
      }
    }

    this.expressionBuffer = new ExpressionBuffer(this.instanceCount);

    if (this.useWebGPU) {
      this.initComputeNode();
    } else {
      this.computeNode = null;
      console.warn('[CharacterManager] WebGL mode: CPU movement + bind-pose characters (no storage shaders).');
    }
    this.createInstancedMesh();
  }

  private initComputeNode() {
    const agentStorage = this.agentStateBuffer!.storageNode;

    this.computeNode = Fn(() => {
      const index = instanceIndex;

      const posElement = this.positionStorage.element(index);
      const velElement = this.velocityStorage.element(index);
      const agentData = agentStorage.element(index.mul(2));   // Buffer 0: (wpX, anim, wpZ, state)
      const agentState = agentData.w;                         // float: 0=IDLE 1=GOTO 2=SEATED

      const pos = posElement.xyz.toVar();

      // ── Physical Logic ──────────────────────────────────────

      // GOTO = 1  |  IDLE = 0  |  SEATED = 2 (treated as IDLE on GPU)
      const isGoto = agentState.greaterThan(float(0.5)).and(agentState.lessThan(float(1.5)));

      If(isGoto, () => {
        const waypointXZ = vec3(agentData.x, float(0), agentData.z);
        const toTarget = waypointXZ.sub(pos);
        const dist = toTarget.length();
        If(dist.greaterThan(float(0.2)), () => {
          const gotoVel = toTarget.normalize().mul(this.uSpeed.mul(3.0));
          velElement.assign(vec4(gotoVel, 0.0));
          posElement.assign(vec4(pos.add(gotoVel), 1.0));
        }).Else(() => {
          // Snap X,Z to exact waypoint — CPU will transition to IDLE this frame
          posElement.assign(vec4(agentData.x, pos.y, agentData.z, 1.0));
        });

      }).Else(() => {
        // ── IDLE / SEATED (0 or 2) ───────────────────────────────
        // Zero velocity so the vertex shader uses facingOverride (setFacing/setOrientation)
        // instead of the stale walk velocity for rotation.
        // SEATED (2) is handled identically on the GPU — the semantic difference is CPU-only.
        velElement.assign(vec4(float(0), float(0), float(0), float(0)));
        posElement.assign(vec4(pos, 1.0));
      });

    })().compute(this.instanceCount);
  }

  private createInstancedMesh() {
    // Reorder meshData: Body FIRST, then features (eyes/mouth)
    // This ensures body writes to depth buffer before features are drawn over it.
    const sortedMeshData = [...this.meshData].sort((a, b) => {
      const aIsBody = a.name.toLowerCase().includes('body');
      const bIsBody = b.name.toLowerCase().includes('body');
      if (aIsBody && !bIsBody) return -1;
      if (!aIsBody && bIsBody) return 1;
      return 0;
    });

    for (const { name, geometry, material: baseMaterial } of sortedMeshData) {
      const instancedGeometry = new THREE.InstancedBufferGeometry();
      instancedGeometry.copy(geometry as any);
      instancedGeometry.instanceCount = this.instanceCount;

      // Drop null/undefined attrs so NodeBuilder never calls getTypeFromAttribute(null).
      for (const attrName of Object.keys(instancedGeometry.attributes)) {
        if (!instancedGeometry.attributes[attrName]) {
          instancedGeometry.deleteAttribute(attrName);
        }
      }

      // WebGL2: integer JOINTS_0 attrs often break NodeMaterial — promote to float.
      const skinIndexAttr = instancedGeometry.getAttribute('skinIndex');
      if (skinIndexAttr && !(skinIndexAttr.array instanceof Float32Array)) {
        instancedGeometry.setAttribute(
          'skinIndex',
          new THREE.BufferAttribute(new Float32Array(skinIndexAttr.array as ArrayLike<number>), 4)
        );
      }
      const skinWeightAttr = instancedGeometry.getAttribute('skinWeight');
      if (skinWeightAttr && !(skinWeightAttr.array instanceof Float32Array)) {
        instancedGeometry.setAttribute(
          'skinWeight',
          new THREE.BufferAttribute(new Float32Array(skinWeightAttr.array as ArrayLike<number>), 4)
        );
      }

      // Solo dejamos el atributo que NO se calcula en el Compute Shader
      instancedGeometry.setAttribute('instanceColor', this.colorAttribute!);
      if (this.accessoryAttribute) instancedGeometry.setAttribute('accessoryType', this.accessoryAttribute);

      if (!this.useWebGPU) {
        instancedGeometry.setAttribute('instancePos', this.instancePosAttr!);
        instancedGeometry.setAttribute('instanceFacing', this.instanceFacingAttr!);
        instancedGeometry.setAttribute('instanceAlpha', this.instanceAlphaAttr!);
        instancedGeometry.setAttribute('expressionData', this.expressionAttr!);
      }

      const material = new THREE.MeshStandardNodeMaterial();
      material.roughness = 1;
      material.metalness = 0.25;

      const instanceColor = attribute('instanceColor', 'vec3');
      const map = (baseMaterial as any).map;

      const expressionData = this.useWebGPU
        ? this.expressionBuffer!.storageNode.element(instanceIndex)
        : attribute('expressionData', 'vec4');
      const instanceAlpha = this.useWebGPU
        ? this.agentStateBuffer!.storageNode.element(instanceIndex.mul(2).add(1)).z
        : attribute('instanceAlpha', 'float');
      const accessoryType = attribute('accessoryType', 'float');

      const isEyes = name.toLowerCase().includes('eyes');
      const isMouth = name.toLowerCase().includes('mouth');
      const isHeadphones = name.toLowerCase().includes('headphones');
      const isCap = name.toLowerCase().includes('cap');

      if (isEyes) {
        material.uvNode = uv().add(expressionData.xy);
      } else if (isMouth) {
        material.uvNode = uv().add(expressionData.zw);
      }

      // Solo coloreamos el mesh cuyo nombre sea 'body' o accesorios
      material.transparent = true;

      const isAccessory = isHeadphones || isCap;
      const isBody = name.toLowerCase().includes('body');

      if (isHeadphones) {
        material.opacityNode = accessoryType.equal(float(1)).select(instanceAlpha, float(0));
      } else if (isCap) {
        material.opacityNode = accessoryType.equal(float(2)).select(instanceAlpha, float(0));
      }

      if (isBody || isAccessory) {
        material.depthWrite = true;
        material.depthTest = true;

        const baseAlpha = isAccessory ? material.opacityNode : (map ? texture(map).a.mul(instanceAlpha) : instanceAlpha);

        if (map) {
          const texColor = texture(map);
          material.colorNode = vec4(texColor.rgb.mul(instanceColor), baseAlpha);
        } else {
          material.colorNode = vec4(instanceColor, baseAlpha);
        }
      } else {
        // Eyes / mouth: rendered on top of the body surface with polygon offset to avoid
        // z-fighting, but still respect the depth buffer so they are occluded by walls etc.
        material.depthWrite = false;
        material.depthTest = true;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;

        if (map) {
          const texColor = isEyes || isMouth ? texture(map, material.uvNode) : texture(map);
          material.colorNode = vec4(texColor.rgb, texColor.a.mul(instanceAlpha));
        } else {
          material.opacityNode = float(0);
        }
      }

      // Special skinning for static accessories
      if ((isHeadphones || isCap) && this.headBoneIndex !== -1 && !geometry.attributes.skinIndex) {
        const skinIndices = new Float32Array(geometry.attributes.position.count * 4).fill(this.headBoneIndex);
        const skinWeights = new Float32Array(geometry.attributes.position.count * 4).fill(0);
        for (let i = 0; i < geometry.attributes.position.count; i++) skinWeights[i * 4] = 1.0;
        instancedGeometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
        instancedGeometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
      }

      const isVisible = isHeadphones ? accessoryType.equal(float(1)) : (isCap ? accessoryType.equal(float(2)) : float(1));
      const vertexNode = this.useWebGPU
        ? this.createVertexNode(isVisible.and(instanceAlpha.greaterThan(0)))
        : this.createWebGLVertexNode(isVisible.and(instanceAlpha.greaterThan(0)));
      material.positionNode = vertexNode;
      (material as any).castShadowPositionNode = vertexNode;

      const instancedMesh = new THREE.Mesh(instancedGeometry, material);
      instancedMesh.frustumCulled = false;
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;
      // Body renders first (renderOrder 0), features after (renderOrder 1)
      instancedMesh.renderOrder = name.toLowerCase().includes('body') ? 0 : 1;
      this.scene.add(instancedMesh);
      this.instancedMeshes.push(instancedMesh);
    }
  }

  /** WebGL2-safe vertex transform: instanced attrs only (bind pose, no storage skinning). */
  private createWebGLVertexNode(isVisibleNode: any) {
    return Fn(() => {
      const instancePos = attribute('instancePos', 'vec3');
      const facing = attribute('instanceFacing', 'vec3');

      const angle = atan(facing.z, facing.x).negate().add(float(Math.PI / 2));
      const rotationMat = mat3(
        vec3(cos(angle), float(0), sin(angle).negate()),
        vec3(float(0), float(1), float(0)),
        vec3(sin(angle), float(0), cos(angle))
      );

      const vertexScale = isVisibleNode.select(float(1), float(0));
      return rotationMat.mul(positionLocal.mul(vertexScale)).add(instancePos);
    })();
  }

  /** CPU GOTO integration when compute shaders are unavailable. */
  private simulateMovementCPU(delta: number) {
    if (!this.debugPosArray || !this.agentStateBuffer) return;
    const step = Math.min(delta, 0.05) * 1.35;

    for (let i = 0; i < this.instanceCount; i++) {
      if (this.agentStateBuffer.getState(i) !== AgentBehavior.GOTO) continue;
      const wp = this.agentStateBuffer.getWaypoint(i);
      const x = this.debugPosArray[i * 4];
      const z = this.debugPosArray[i * 4 + 2];
      const dx = wp.x - x;
      const dz = wp.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.2) {
        this.debugPosArray[i * 4] = wp.x;
        this.debugPosArray[i * 4 + 2] = wp.z;
      } else {
        this.debugPosArray[i * 4] += (dx / dist) * step;
        this.debugPosArray[i * 4 + 2] += (dz / dist) * step;
      }
    }

    if (this.posAttribute) {
      (this.posAttribute.array as Float32Array).set(this.debugPosArray);
      this.posAttribute.needsUpdate = true;
    }
  }

  private syncWebGLInstanceAttrs() {
    if (
      !this.instancePosAttr ||
      !this.instanceFacingAttr ||
      !this.instanceAlphaAttr ||
      !this.expressionAttr ||
      !this.debugPosArray ||
      !this.agentStateBuffer ||
      !this.expressionBuffer
    ) {
      return;
    }

    const pos = this.instancePosAttr.array as Float32Array;
    const facing = this.instanceFacingAttr.array as Float32Array;
    const alpha = this.instanceAlphaAttr.array as Float32Array;

    for (let i = 0; i < this.instanceCount; i++) {
      pos[i * 3] = this.debugPosArray[i * 4];
      pos[i * 3 + 1] = this.debugPosArray[i * 4 + 1];
      pos[i * 3 + 2] = this.debugPosArray[i * 4 + 2];

      const wp = this.agentStateBuffer.getWaypoint(i);
      const state = this.agentStateBuffer.getState(i);
      if (state === AgentBehavior.GOTO) {
        const dx = wp.x - pos[i * 3];
        const dz = wp.z - pos[i * 3 + 2];
        const len = Math.hypot(dx, dz) || 1;
        facing[i * 3] = dx / len;
        facing[i * 3 + 1] = 0;
        facing[i * 3 + 2] = dz / len;
      } else if (Math.hypot(wp.x, wp.z) > 0.01) {
        facing[i * 3] = wp.x;
        facing[i * 3 + 1] = 0;
        facing[i * 3 + 2] = wp.z;
      } else {
        facing[i * 3] = 0;
        facing[i * 3 + 1] = 0;
        facing[i * 3 + 2] = 1;
      }

      alpha[i] = this.agentStateBuffer.getAlpha(i);
    }

    (this.expressionAttr.array as Float32Array).set(this.expressionBuffer.array);
    this.instancePosAttr.needsUpdate = true;
    this.instanceFacingAttr.needsUpdate = true;
    this.instanceAlphaAttr.needsUpdate = true;
    this.expressionAttr.needsUpdate = true;
  }

  private createVertexNode(isVisibleNode: any) {
    return Fn(() => {
      const instancePos = this.positionStorage.element(instanceIndex).xyz;
      const rawVel = this.velocityStorage.element(instanceIndex).xyz;
      const agentData = this.agentStateBuffer!.storageNode.element(instanceIndex.mul(2));
      const animParams = this.agentStateBuffer!.storageNode.element(instanceIndex.mul(2).add(1));

      // 1. Determine local rotation (facing)
      const isMoving = rawVel.length().greaterThan(float(0.01));
      const facingOverride = vec3(agentData.x, float(0), agentData.z);
      const hasFacingOverride = facingOverride.length().greaterThan(float(0));

      const facing = vec3(0, 0, 1).toVar(); // Default: Forward

      If(isMoving, () => {
        facing.assign(rawVel);
      }).ElseIf(hasFacingOverride, () => {
        facing.assign(facingOverride);
      });

      const angle = atan(facing.z, facing.x).negate().add(float(Math.PI / 2));
      const rotationMat = mat3(
        vec3(cos(angle), float(0), sin(angle).negate()),
        vec3(float(0), float(1), float(0)),
        vec3(sin(angle), float(0), cos(angle))
      );

      const finalPosition = positionLocal.toVar();

      if (this.bakedAnimationsBuffer && this.metaBuffer) {
        const mat4Count = Math.floor(this.bakedAnimationsBuffer.array.length / 16);
        const animBuffer = storage(this.bakedAnimationsBuffer, 'mat4', mat4Count).setPBO(true).toReadOnly();
        const metaStorage = storage(this.metaBuffer, 'vec4', this.metaBuffer.count).setPBO(true).toReadOnly();

        const animIndex = agentData.y.toUint();

        const meta = metaStorage.element(animIndex);
        const animOffset = uint(meta.x);
        const numFrames = uint(meta.y);
        const duration = float(meta.z);

        const startTime = animParams.x;
        const loopMode = animParams.y;

        const animTime = this.uTime.sub(startTime).max(0);
        const t = loopMode.greaterThan(0.5) ? animTime.div(duration).fract() : animTime.div(duration).clamp(0, 1);

        const currentFrame = t.mul(numFrames.toFloat()).toUint();
        const safeFrame = currentFrame.min(numFrames.sub(uint(1)));

        const skinIndex = attribute('skinIndex', 'vec4');
        const skinWeight = attribute('skinWeight', 'vec4');
        const skinMat = mat4(0).toVar();

        const addInfluence = (boneIdxNode: any, weightNode: any) => {
          If(weightNode.greaterThan(0), () => {
            const address = animOffset.add(safeFrame.mul(uint(this.numBones))).add(boneIdxNode.toUint());
            skinMat.addAssign(animBuffer.element(address).mul(weightNode));
          });
        };

        addInfluence(skinIndex.x, skinWeight.x);
        addInfluence(skinIndex.y, skinWeight.y);
        addInfluence(skinIndex.z, skinWeight.z);
        addInfluence(skinIndex.w, skinWeight.w);

        finalPosition.assign(skinMat.mul(vec4(positionLocal, 1.0)).xyz);
      }

      const vertexScale = isVisibleNode.select(float(1), float(0));
      return rotationMat.mul(finalPosition.mul(vertexScale)).add(instancePos);
    })();
  }

  private bakeAnimation(mesh: THREE.SkinnedMesh, clip: THREE.AnimationClip, root: THREE.Object3D) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    const skeleton = mesh.skeleton;
    const duration = clip.duration;
    const numFrames = Math.ceil(duration * 60);
    const numBones = skeleton.bones.length;
    const data = new Float32Array(numFrames * numBones * 16);
    for (let f = 0; f < numFrames; f++) {
      mixer.setTime((f / numFrames) * duration);
      root.updateMatrixWorld(true);
      skeleton.update();
      for (let b = 0; b < numBones; b++) {
        const i = (f * numBones + b) * 16;
        for (let k = 0; k < 16; k++) data[i + k] = skeleton.boneMatrices[b * 16 + k];
      }
    }
    return {
      data,
      numFrames,
      duration,
    };
  }

  public getCount() { return this.instanceCount; }

  /** Exposes the agent state buffer so BehaviorManager can read/write states. */
  public getAgentStateBuffer(): AgentStateBuffer | null {
    return this.agentStateBuffer;
  }

  /** Returns the current CPU-tracked positions buffer (vec4 stride). Updated each simulateOnCPU call. */
  public getCPUPositions(): Float32Array | null {
    return this.debugPosArray;
  }

  /** Returns the world position of a single character from the CPU buffer. */
  public getCPUPosition(index: number): THREE.Vector3 | null {
    if (!this.debugPosArray || index < 0 || index >= this.instanceCount) return null;
    const i = index * 4;
    return new THREE.Vector3(this.debugPosArray[i], this.debugPosArray[i + 1], this.debugPosArray[i + 2]);
  }

  public setPhysicsMode(index: number, mode: AgentBehavior) {
    if (!this.agentStateBuffer || index < 0 || index >= this.instanceCount) return;
    this.agentStateBuffer.setState(index, mode);
  }

  /** Teleport an agent to an exact world position by writing directly to the CPU→GPU buffer. */
  public setPosition(index: number, position: THREE.Vector3): void {
    if (!this.posAttribute || index < 0 || index >= this.instanceCount) return;
    const arr = this.posAttribute.array as Float32Array;
    arr[index * 4 + 0] = position.x;
    arr[index * 4 + 1] = position.y;
    arr[index * 4 + 2] = position.z;
    this.posAttribute.needsUpdate = true;
    if (this.debugPosArray) {
      this.debugPosArray[index * 4 + 0] = position.x;
      this.debugPosArray[index * 4 + 1] = position.y;
      this.debugPosArray[index * 4 + 2] = position.z;
    }
    if (this.instancePosAttr) {
      const p = this.instancePosAttr.array as Float32Array;
      p[index * 3] = position.x;
      p[index * 3 + 1] = position.y;
      p[index * 3 + 2] = position.z;
      this.instancePosAttr.needsUpdate = true;
    }
  }

  /** Teleport an agent and zero their current velocity to avoid sliding. */
  public setPositionAndZeroVelocity(index: number, position: THREE.Vector3): void {
    this.setPosition(index, position);
    if (this.velAttribute && index >= 0 && index < this.instanceCount) {
      const arr = this.velAttribute.array as Float32Array;
      arr[index * 4 + 0] = 0;
      arr[index * 4 + 1] = 0;
      arr[index * 4 + 2] = 0;
      arr[index * 4 + 3] = 0;
      this.velAttribute.needsUpdate = true;
    }
  }

  /** Force a specific facing direction when IDLE. */
  public setFacing(index: number, x: number, z: number) {
    if (!this.agentStateBuffer || index < 0 || index >= this.instanceCount) return;
    this.agentStateBuffer.setFacing(index, x, z);
  }

  /** Force a specific orientation based on a quaternion. */
  public setOrientation(index: number, quaternion: THREE.Quaternion) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    this.setFacing(index, forward.x, forward.z);
  }

  public getAgentState(index: number): AgentBehavior {
    if (!this.agentStateBuffer || index < 0 || index >= this.instanceCount) return AgentBehavior.IDLE;
    return this.agentStateBuffer.getState(index) as AgentBehavior;
  }

  public setAnimation(index: number, name: AnimationName, loop: boolean = true) {
    if (this.agentStateBuffer && index >= 0 && index < this.instanceCount) {
      const meta = this.animationsMeta[name];
      if (meta) {
        this.agentStateBuffer.setAnimation(index, meta.index, loop, this.currentTime);
      }
    }
  }

  public getAnimationIndex(index: number): number {
    if (!this.agentStateBuffer || index < 0 || index >= this.instanceCount) return 0;
    return this.agentStateBuffer.getAnimation(index);
  }

  public getAnimationMeta(name: AnimationName) {
    return this.animationsMeta[name];
  }

  /** Returns the baked clip duration in seconds. Returns 1.0 if the animation is not found. */
  public getAnimationDuration(name: AnimationName): number {
    return this.animationsMeta[name]?.duration ?? 1.0;
  }

  public setExpression(index: number, name: ExpressionKey) {
    if (this.expressionBuffer) {
      this.expressionBuffer.setExpression(index, name);
    }
  }

  public setSpeaking(index: number, isSpeaking: boolean) {
    if (this.expressionBuffer) {
      this.expressionBuffer.setSpeaking(index, isSpeaking);
    }
    // Note: External logic should handle TALK/IDLE animations
  }

  public setColors() {
    if (this.isLoaded) {
      this.cleanupInstances();
      this.initInstances();
    }
  }
}
