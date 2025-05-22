import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Point } from '@/utils/roomModeCalculations';
import { Speaker, Head } from 'lucide-react';

interface DraggablePointProps {
  position: Point;
  color: string;
  onPositionChange: (position: Point) => void;
  isSelected: boolean;
  onSelect: () => void;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  type: 'speaker' | 'head';
}

const DraggablePoint: React.FC<DraggablePointProps> = ({ 
  position, 
  color, 
  onPositionChange, 
  isSelected, 
  onSelect,
  scene,
  camera,
  renderer,
  type
}) => {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const isDragging = useRef(false);
  const plane = useRef(new THREE.Plane());
  const raycaster = useRef(new THREE.Raycaster());
  const intersection = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());

  useEffect(() => {
    // Create point geometry based on type
    let geometry;

    if (type === 'speaker') {
      // Box for speaker (e.g., 0.3m W x 0.4m H x 0.3m D)
      geometry = new THREE.BoxGeometry(0.3, 0.4, 0.3);
    } else {
      // Sphere for head (radius ~0.09m for a ~0.18m diameter)
      geometry = new THREE.SphereGeometry(0.09, 16, 16);
    }
    
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.z, position.y);
    
    if (type === 'head') {
      // Override color for head to grey
      (mesh.material as THREE.MeshStandardMaterial).color.set(0xaaaaaa); // Medium grey
      // Scale for oval shape: taller and deeper
      // Mesh X-axis = room X (width of head)
      // Mesh Y-axis = room Z (height of head)
      // Mesh Z-axis = room Y (depth of head)
      mesh.scale.set(1, 1.22, 1.11); // Approx: 0.18m wide, 0.22m tall, 0.20m deep
    }
    
    // Add a directional indicator for the speaker/head
    if (type === 'speaker') {
      // Add speaker cone/driver (scaled down)
      // Original: CylinderGeometry(0.2, 0.1, 0.15, 16) on Box (0.5, 0.8, 0.5)
      // New Box is roughly 0.6x original size.
      // New driver: CylinderGeometry(0.2*0.6, 0.1*0.6, 0.15*0.6) -> (0.12, 0.06, 0.09)
      const driverGeometry = new THREE.CylinderGeometry(0.12, 0.06, 0.09, 16);
      const driverMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
      const driver = new THREE.Mesh(driverGeometry, driverMaterial);
      driver.rotation.x = Math.PI / 2;
      driver.position.set(0, 0, 0.15); // Relative position, adjust if main speaker depth changed
      mesh.add(driver);
      
      // Add speaker port (scaled down)
      // Original: CylinderGeometry(0.08, 0.08, 0.15, 16)
      // New port: CylinderGeometry(0.08*0.6, 0.08*0.6, 0.15*0.6) -> (0.048, 0.048, 0.09)
      const portGeometry = new THREE.CylinderGeometry(0.048, 0.048, 0.09, 16);
      const portMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });
      const port = new THREE.Mesh(portGeometry, portMaterial);
      port.rotation.x = Math.PI / 2;
      // Adjust Y position relative to new speaker height (0.4m)
      // Original was -0.2 on a 0.8 height box. New is -0.2 * (0.4/0.8) = -0.1
      port.position.set(0, -0.1, 0.15); // Relative position, adjust Y and Z if needed
      mesh.add(port);
    } else {
      // Add ear-like protrusions for head (scaled down)
      const earGeometry = new THREE.SphereGeometry(0.024, 8, 8);
      // Darker grey for ears
      const earMaterial = new THREE.MeshStandardMaterial({ color: 0x888888 }); 
      
      // Left ear (adjust position based on new head radius and scale)
      // Original position 0.09. It's along mesh X-axis, which has scale 1.
      const leftEar = new THREE.Mesh(earGeometry, earMaterial);
      leftEar.position.set(0.09, 0, 0); // Position relative to head center
      mesh.add(leftEar);
      
      // Right ear (adjust position based on new head radius and scale)
      const rightEar = new THREE.Mesh(earGeometry, earMaterial);
      rightEar.position.set(-0.09, 0, 0); // Position relative to head center
      mesh.add(rightEar);
    }

    // Defer adding to scene slightly to ensure parent rendering cycle might be complete
    meshRef.current = mesh;
    let animationFrameId: number;
    const addMeshToScene = () => {
        animationFrameId = requestAnimationFrame(() => {
            if (meshRef.current && scene.getObjectById(meshRef.current.id) === undefined) {
                scene.add(meshRef.current);
            }
        });
    };
    addMeshToScene();
    
    const handlePointerDown = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.current.setFromCamera({ x, y }, camera);
      const intersects = raycaster.current.intersectObject(mesh);
      
      if (intersects.length > 0) {
        onSelect();
        if (isSelected) {
          isDragging.current = true;
          
          plane.current.setFromNormalAndCoplanarPoint(
            camera.getWorldDirection(new THREE.Vector3()).negate(),
            mesh.position
          );
          
          raycaster.current.setFromCamera({ x, y }, camera);
          if (raycaster.current.ray.intersectPlane(plane.current, intersection.current)) {
            offset.current.copy(intersection.current).sub(mesh.position);
          }
        }
        event.preventDefault();
      }
    };

    const handlePointerMove = (event: MouseEvent) => {
      if (isDragging.current && isSelected && meshRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        
        raycaster.current.setFromCamera({ x, y }, camera);
        if (raycaster.current.ray.intersectPlane(plane.current, intersection.current)) {
          meshRef.current.position.copy(intersection.current.sub(offset.current));
          
          // Update the position in parent component
          onPositionChange({
            x: meshRef.current.position.x,
            y: meshRef.current.position.z,
            z: meshRef.current.position.y
          });
        }
      }
    };

    const handlePointerUp = () => {
      isDragging.current = false;
      
      if (meshRef.current) {
        onPositionChange({
          x: meshRef.current.position.x,
          y: meshRef.current.position.z,
          z: meshRef.current.position.y
        });
      }
    };

    // Add event listeners
    renderer.domElement.addEventListener('mousedown', handlePointerDown);
    renderer.domElement.addEventListener('mousemove', handlePointerMove);
    renderer.domElement.addEventListener('mouseup', handlePointerUp);

    // Update position if it changes externally
    if (meshRef.current) {
      meshRef.current.position.set(position.x, position.z, position.y);
    }

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId); // Ensure to cancel the frame
      renderer.domElement.removeEventListener('mousedown', handlePointerDown);
      renderer.domElement.removeEventListener('mousemove', handlePointerMove);
      renderer.domElement.removeEventListener('mouseup', handlePointerUp);
      
      if (meshRef.current) {
        scene.remove(meshRef.current);
      }
    };
  }, [position, color, isSelected, scene, camera, renderer, onPositionChange, onSelect, type]);

  return null; // We're directly manipulating the Three.js scene
};

// Export the component
export { DraggablePoint };
