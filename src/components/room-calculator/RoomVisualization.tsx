import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DraggablePoint } from './DraggablePoint';
import { Point, RoomDimensions } from '@/utils/roomModeCalculations';

interface RoomVisualizationProps {
  room: RoomDimensions;
  sub: Point;
  listener: Point;
  selectedPoint: string | null;
  onSubPositionChange: (position: Point) => void;
  onListenerPositionChange: (position: Point) => void;
  onSelectPoint: (point: string | null) => void;
  resetTrigger?: number;
  showAngleGuidelines?: boolean;
  highlightedSurface?: string | null;
}

const SPEAKER_GUIDELINE_1_NAME = 'speakerGuideline1';
const SPEAKER_GUIDELINE_2_NAME = 'speakerGuideline2';
const SPEAKER_ANGLE_ARC_NAME = 'speakerAngleArc';

export function RoomVisualization({
  room,
  sub,
  listener,
  selectedPoint,
  onSubPositionChange,
  onListenerPositionChange,
  onSelectPoint,
  resetTrigger,
  showAngleGuidelines,
  highlightedSurface
}: RoomVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderer, setRenderer] = useState<THREE.WebGLRenderer | null>(null);
  const [scene, setScene] = useState<THREE.Scene | null>(null);
  const [camera, setCamera] = useState<THREE.PerspectiveCamera | null>(null);
  const [controls, setControls] = useState<OrbitControls | null>(null);
  
  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Capture the current container element to use in cleanup
    const currentContainer = containerRef.current;
    
    // Clear previous content
    currentContainer.innerHTML = '';
    
    // Create renderer
    const newRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    newRenderer.setSize(currentContainer.clientWidth, currentContainer.clientHeight);
    newRenderer.setClearColor(0x000000, 0); // Transparent background
    currentContainer.appendChild(newRenderer.domElement);
    
    // Create scene
    const newScene = new THREE.Scene();
    
    // Create camera
    const newCamera = new THREE.PerspectiveCamera(
      50, 
      currentContainer.clientWidth / currentContainer.clientHeight, // Initial aspect from container
      0.1, 
      1000
    );

    // Calculate camera position and target to view the whole room in the upper-left
    const roomCenterX_Three = room.L / 2;
    const roomCenterY_Three_Up = room.H / 2;
    const roomCenterZ_Three_Depth = room.W / 2;

    // Target the center of the room
    const targetX = roomCenterX_Three;
    const targetY = roomCenterY_Three_Up;
    const targetZ = roomCenterZ_Three_Depth;

    // Position camera to view room in upper-left, tilted down
    const distanceBack = Math.max(room.L, room.W, room.H) * 1.2; // Zoomed in a bit
    const offsetXFromCenter = room.L * 0; 
    const offsetY_Above_Center = room.H * 0.1; // Lowered camera height relative to center

    const camPosX = roomCenterX_Three + offsetXFromCenter;
    const camPosY = roomCenterY_Three_Up + offsetY_Above_Center; 
    const camPosZ = roomCenterZ_Three_Depth + distanceBack;

    newCamera.position.set(camPosX, camPosY, camPosZ);
    const initialTargetVec = new THREE.Vector3(targetX, targetY, targetZ);
    newCamera.lookAt(initialTargetVec);
    newCamera.rotateX(THREE.MathUtils.degToRad(10)); // Tilt upward by 10 degrees
    newCamera.updateMatrixWorld(); // Ensure camera's matrixWorld is up-to-date

    // Pan the view: shift camera and target together
    const shiftUpAmount = room.H * -0.03; // Adjusted pan to keep room in view
    const shiftLeftAmount = room.L * -0;

    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(newCamera.quaternion);
    const worldRight = new THREE.Vector3(1, 0, 0).applyQuaternion(newCamera.quaternion);

    const panOffset = new THREE.Vector3();
    panOffset.addScaledVector(worldUp, shiftUpAmount);
    panOffset.addScaledVector(worldRight, -shiftLeftAmount); // Negative for left shift

    newCamera.position.add(panOffset);
    const finalTargetVec = initialTargetVec.clone().add(panOffset);
    
    // Create orbit controls
    const newControls = new OrbitControls(newCamera, newRenderer.domElement);
    newControls.enableDamping = true;
    newControls.dampingFactor = 0.1;
    newControls.addEventListener('start', () => onSelectPoint(null)); 
    newControls.target.copy(finalTargetVec); // Orbit around the new panned target
    newControls.update();
    
    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2); // Further increased ambient light
    newScene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // Increased directional light
    directionalLight.position.set(10, 10, 10);
    newScene.add(directionalLight);
    
    // Update state
    setRenderer(newRenderer);
    setScene(newScene);
    setCamera(newCamera);
    setControls(newControls);
    
    // Handle resize using ResizeObserver
    const handleResize = () => {
      if (currentContainer && newCamera && newRenderer) {
        const width = currentContainer.clientWidth;
        const height = currentContainer.clientHeight;
        if (width > 0 && height > 0) { // Ensure dimensions are positive
          newRenderer.setSize(width, height); // Moved setSize here to be primary
          newCamera.aspect = width / height;
          newCamera.updateProjectionMatrix();
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(currentContainer);
    
    // Initial call to set size correctly
    handleResize();

    // Animation loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (newControls) newControls.update();
      if (newRenderer && newScene && newCamera) {
        newRenderer.render(newScene, newCamera);
      }
    };
    
    animate();
    
    // Cleanup
    return () => {
      resizeObserver.unobserve(currentContainer);
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);
      newControls.dispose();
      newRenderer.dispose();
      currentContainer.innerHTML = '';
    };
  }, [room.L, room.W, room.H, onSelectPoint, resetTrigger]);
  
  // Create room wireframe and grid
  useEffect(() => {
    if (!scene) return;
    
    // Clear previous room objects if they exist by name
    const roomMeshToRemove = scene.getObjectByName('roomMesh');
    if (roomMeshToRemove) scene.remove(roomMeshToRemove);
    const wireframeToRemove = scene.getObjectByName('roomWireframe');
    if (wireframeToRemove) scene.remove(wireframeToRemove);
    const gridHelperToRemove = scene.getObjectByName('gridHelper');
    if (gridHelperToRemove) scene.remove(gridHelperToRemove);
    
    // Room mesh with multiple materials for face highlighting
    const roomGeometry = new THREE.BoxGeometry(room.L, room.H, room.W);
    
    // Initial base material setup (will be managed by the highlighting effect)
    const initialBaseMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5, // Even lighter gray for walls
      transparent: true,
      opacity: 0.10, // Drastically reduced opacity for a lighter feel
      side: THREE.DoubleSide // Changed to DoubleSide
    });
    const materials = Array(6).fill(null).map(() => initialBaseMaterial.clone());
    const roomMesh = new THREE.Mesh(roomGeometry, materials);
    roomMesh.name = 'roomMesh';
    roomMesh.position.set(room.L / 2, room.H / 2, room.W / 2);
    scene.add(roomMesh);

    // Add wireframe separately for constant visibility
    const wireframeMaterial = new THREE.LineBasicMaterial({ 
      color: 0x000000, // Black for better contrast
      transparent: true, 
      opacity: 0.7, // More opaque
      depthTest: false // Render on top
    });
    const wireframeGeo = new THREE.EdgesGeometry(roomMesh.geometry);
    const wireframe = new THREE.LineSegments(wireframeGeo, wireframeMaterial);
    wireframe.name = 'roomWireframe';
    wireframe.renderOrder = 1; // Attempt to render on top of faces
    wireframe.position.copy(roomMesh.position);
    scene.add(wireframe);

    // Floor grid for orientation
    // Make the grid exactly as large as the greater of Length or Width
    // And set divisions to match that dimension for 1-unit grid cells.
    const gridSize = Math.max(room.L, room.W);
    const divisions = Math.floor(gridSize); // Aim for 1-meter divisions
    
    const gridHelper = new THREE.GridHelper(gridSize, divisions > 0 ? divisions : 1); // Ensure divisions is at least 1
    gridHelper.name = 'gridHelper'; // Name for easy removal
    gridHelper.position.set(room.L / 2, 0, room.W / 2); 
    scene.add(gridHelper);
    
    // Coordinate axes (usually okay to keep one instance)
    if (!scene.getObjectByName('axesHelper')) {
        const axesHelper = new THREE.AxesHelper(0.5);
        axesHelper.name = 'axesHelper';
        scene.add(axesHelper);
    }
    
  }, [scene, room]); // room.L, room.W, room.H are part of 'room' object

  // Effect to update highlighted surface material
  useEffect(() => {
    // Ensure scene is initialized before proceeding
    if (!scene) {
      return;
    }

    const roomMesh = scene.getObjectByName('roomMesh') as THREE.Mesh;
    if (!roomMesh || !Array.isArray(roomMesh.material)) return; // Exit if roomMesh not ready

    const standardBaseOpacity = 0.10; // Drastically reduced opacity
    const fadedBaseOpacity = 0.02;    // Very faint for faded state
    const highlightOpacity = 0.5; // Keep highlight fairly visible

    const currentHighlightMaterial = new THREE.MeshStandardMaterial({
      color: 0x007bff, 
      emissive: 0x007bff, 
      emissiveIntensity: 0.6, 
      transparent: true, 
      opacity: highlightOpacity, 
      side: THREE.DoubleSide, 
      name: 'highlightMaterialName',
      depthWrite: false
    });

    if (!highlightedSurface) {
      // Reset all to standard base material
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0xf5f5f5, // Use new lighter gray
        transparent: true, 
        opacity: standardBaseOpacity, 
        side: THREE.DoubleSide, 
        name: 'standardBaseMaterial',
        depthWrite: false
      });
      roomMesh.material = Array(6).fill(null).map(() => baseMat.clone());
      return;
    }
    
    // A surface is highlighted
    const newMaterials = Array(6).fill(null).map(() => 
      new THREE.MeshStandardMaterial({
        color: 0xf5f5f5, // Use new lighter gray
        transparent: true, 
        opacity: fadedBaseOpacity, 
        side: THREE.DoubleSide, 
        name: 'fadedBaseMaterial',
        depthWrite: false,
        alphaTest: 0.01
      }).clone()
    );

    // BoxGeometry faces order: +X, -X, +Y, -Y, +Z, -Z
    // Our surfaces (assuming L=X, W=Y(depth), H=Z(up)):
    // right: +X (index 0)
    // left: -X (index 1)
    // ceiling: +Y (index 2) (Box Y maps to Room H/Z)
    // floor: -Y (index 3) (Box Y maps to Room H/Z)
    // front: +Z (index 4) (Box Z maps to Room W/Y)
    // back: -Z (index 5) (Box Z maps to Room W/Y)

    let highlightIndex = -1;
    switch (highlightedSurface) {
      case 'right': highlightIndex = 0; break; 
      case 'left': highlightIndex = 1; break;  
      case 'ceiling': highlightIndex = 2; break;
      case 'floor': highlightIndex = 3; break;  
      case 'front': highlightIndex = 4; break; 
      case 'back': highlightIndex = 5; break;   
    }

    if (highlightIndex !== -1) {
      newMaterials[highlightIndex] = currentHighlightMaterial; // Use the fully defined highlight material
    }
    roomMesh.material = newMaterials;

  }, [scene, highlightedSurface, room.L, room.W, room.H]);

  // useEffect for speaker guidelines
  useEffect(() => {
    // Always remove old lines/arc regardless of the new prop state first
    const oldLine1Scene = scene?.getObjectByName(SPEAKER_GUIDELINE_1_NAME);
    if (oldLine1Scene) scene.remove(oldLine1Scene);
    const oldLine2Scene = scene?.getObjectByName(SPEAKER_GUIDELINE_2_NAME);
    if (oldLine2Scene) scene.remove(oldLine2Scene);
    const oldArcScene = scene?.getObjectByName(SPEAKER_ANGLE_ARC_NAME);
    if (oldArcScene) scene.remove(oldArcScene);

    if (!showAngleGuidelines || !scene || !listener || !room) { // Check new prop
      return; // Do not draw if prop is false or essential elements are missing
    }

    const currentRoomMesh = scene.getObjectByName('roomMesh') as THREE.Mesh;
    
    if (!currentRoomMesh) {
      return;
    }

    const listenerPos3D = new THREE.Vector3(listener.x, listener.z, listener.y); // X, Height, Depth
    const angleRad = 30 * Math.PI / 180; // 30 degrees (for a 60 degree total spread)

    // Listener's forward is along negative Z in Three.js scene
    const directions = [
      // Right speaker (relative to listener facing -Z)
      new THREE.Vector3(Math.sin(angleRad), 0, -Math.cos(angleRad)).normalize(), 
      // Left speaker
      new THREE.Vector3(-Math.sin(angleRad), 0, -Math.cos(angleRad)).normalize()   
    ];

    const raycaster = new THREE.Raycaster();
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color: 0x0000ff, 
      transparent: true, 
      opacity: 0.5 
    });

    directions.forEach((dir, index) => {
      raycaster.set(listenerPos3D, dir);
      const intersects = raycaster.intersectObject(currentRoomMesh, false);

      if (intersects.length > 0) {
        const intersectionPoint = intersects[0].point;
        const points = [listenerPos3D.clone(), intersectionPoint.clone()];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, lineMaterial);
        line.name = index === 0 ? SPEAKER_GUIDELINE_1_NAME : SPEAKER_GUIDELINE_2_NAME;
        scene.add(line);
      } else {
        console.warn(`Speaker guideline ${index + 1} did not intersect room mesh.`);
        // Optional: draw a shorter fallback line if needed
        const fallbackEndPoint = listenerPos3D.clone().addScaledVector(dir, 5); // 5 units long
        const points = [listenerPos3D.clone(), fallbackEndPoint];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, lineMaterial);
        line.name = index === 0 ? SPEAKER_GUIDELINE_1_NAME : SPEAKER_GUIDELINE_2_NAME;
        scene.add(line);
      }
    });

    // Add 70-degree arc
    const arcRadius = 0.5; // meters from listener
    const arcSegments = 32;
    const arcMaterial = new THREE.LineBasicMaterial({ 
      color: 0x0077ff, 
      transparent: true, 
      opacity: 0.7 
    });

    const manualArcPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= arcSegments; i++) {
        const loopAngle = -angleRad + (2 * angleRad * i / arcSegments); // from -35 to +35 deg
        // Relative to listener's forward (-Z direction)
        manualArcPoints.push(new THREE.Vector3(
            arcRadius * Math.sin(loopAngle),       // X component for arc around -Z axis
            0,                                     // On the horizontal plane of the listener
            arcRadius * -Math.cos(loopAngle)       // Z component for arc around -Z axis (negative because forward is -Z)
        ));
    }
    const manualArcGeometry = new THREE.BufferGeometry().setFromPoints(manualArcPoints.map(p => p.add(listenerPos3D)));
    const finalArcLine = new THREE.Line(manualArcGeometry, arcMaterial);
    finalArcLine.name = SPEAKER_ANGLE_ARC_NAME;
    scene.add(finalArcLine);

    // Cleanup function in useEffect handles removal when component unmounts or dependencies change
    // The logic at the start of this useEffect handles removal when showAngleGuidelines becomes false
    // or other dependencies change causing a re-run.
    return () => {
      const line1 = scene.getObjectByName(SPEAKER_GUIDELINE_1_NAME);
      if (line1) scene.remove(line1);
      const line2 = scene.getObjectByName(SPEAKER_GUIDELINE_2_NAME);
      if (line2) scene.remove(line2);
      const arc = scene.getObjectByName(SPEAKER_ANGLE_ARC_NAME); 
      if (arc) scene.remove(arc);
    };
  }, [scene, listener, room, showAngleGuidelines]); // Add showAngleGuidelines to dependencies

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      
      {renderer && scene && camera && (
        <>
          <DraggablePoint
            position={sub}
            color="#ea384c" // Using the red color from useful-context
            onPositionChange={onSubPositionChange}
            isSelected={selectedPoint === 'sub'}
            onSelect={() => onSelectPoint('sub')}
            scene={scene}
            camera={camera}
            renderer={renderer}
            type="speaker"
          />
          
          <DraggablePoint
            position={listener}
            color="#1EAEDB" // Using the bright blue from useful-context
            onPositionChange={onListenerPositionChange}
            isSelected={selectedPoint === 'listener'}
            onSelect={() => onSelectPoint('listener')}
            scene={scene}
            camera={camera}
            renderer={renderer}
            type="head"
          />
        </>
      )}
    </>
  );
}
