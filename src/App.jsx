import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Leaf, Droplets, Trees, Layers, Info, Settings, Wind, Sun, Sprout, Database } from 'lucide-react';

// --- Voxel Editor Constants ---
const BOUNDARY_SIZE = 5; // 5m x 5m
const UNIT_SIZE_XZ = 0.5; // Horizontal Resolution
const UNIT_SIZE_Y = 0.2;  // Vertical Resolution (Depth)
const GRID_UNITS = BOUNDARY_SIZE / UNIT_SIZE_XZ; // 10x10 grid
const TOTAL_CELLS = GRID_UNITS * GRID_UNITS; // 100 cells

// Default Properties based on Soil Type
// Stored in Metric Units internally: Ksat (mm/hr), Suction (mm), Cost ($/m3)
const INITIAL_SOIL_DEFS = {
  grass: { 
      name: 'Grass (Loam)', 
      color: '#4caf50', 
      porosity: 0.45, fc: 0.25, wp: 0.10, 
      ksat: 10, kslope: 10, suction: 60, 
      cost: 52.97 // ~$1.5/ft3
  }, 
  dirt: { 
      name: 'Mulch / Dirt', 
      color: '#795548', 
      porosity: 0.43, fc: 0.20, wp: 0.10, 
      ksat: 20, kslope: 10, suction: 60,
      cost: 35.31 // ~$1.0/ft3
  }, 
  sandy_loam: {
      name: 'Sandy Loam',
      color: '#d4a373',
      porosity: 0.4, fc: 0.2, wp: 0.08,
      ksat: 25.4, // 1 in/hr = 25.4 mm
      kslope: 10,
      suction: 88.9, // 3.5 in = 88.9 mm
      cost: 81.22 // $2.3/ft3 = 81.22 $/m3
  },
  sand: { 
      name: 'Sand', 
      color: '#f4d03f', 
      porosity: 0.40, fc: 0.05, wp: 0.02, 
      ksat: 100, kslope: 10, suction: 40,
      cost: 42.38 // ~$1.2/ft3
  }, 
  clay: { 
      name: 'Clay', 
      color: '#a1887f', 
      porosity: 0.50, fc: 0.35, wp: 0.20, 
      ksat: 0.5, kslope: 10, suction: 200,
      cost: 35.31 // ~$1.0/ft3
  }, 
  stone: { 
      name: 'Stone / Gravel', 
      color: '#95a5a6', 
      porosity: 0.75, fc: 0.01, wp: 0.005, 
      ksat: 1000, kslope: 5, suction: 10,
      cost: 70.63 // ~$2.0/ft3
  }
};

const WATER_DEF = { color: '#3498db', label: 'Water', opacity: 0.6, transparent: true };

// --- Default Data & Configuration ---

const INITIAL_LULC_DEFS = {
  mulch: { 
    id: 'mulch', 
    name: 'Mulch / Soil', 
    color: '#8B4513', 
    height: 1, 
    shade: 0, 
    kc: 0.3, 
    albedo: 0.08, 
    nature: 0.1,
    roughness: 0.05,
    cost: 0,
    radius: 300
  },
  grass: { 
    id: 'grass', 
    name: 'Grassland', 
    color: '#4ade80', 
    height: 2, 
    shade: 0, 
    kc: 1.0, 
    albedo: 0.20, 
    nature: 0.6,
    roughness: 0.24,
    cost: 20,
    radius: 300
  },
  bush: { 
    id: 'bush', 
    name: 'Bush / Shrub', 
    color: '#65a30d', 
    height: 3, 
    shade: 0.5, 
    kc: 1.0, 
    albedo: 0.18, 
    nature: 0.8,
    roughness: 0.32,
    cost: 0,
    radius: 300 
  },
  forest: { 
    id: 'forest', 
    name: 'Forest / Tree', 
    color: '#15803d', 
    height: 6, 
    shade: 1, 
    kc: 1.0, 
    albedo: 0.15, 
    nature: 1.0,
    roughness: 0.40,
    cost: 0,
    radius: 300
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete / Paved',
    color: '#9ca3af',
    height: 0,
    shade: 0,
    kc: 1.2,
    albedo: 0.30,
    nature: 0,
    roughness: 0.015,
    cost: 32,
    radius: 300
  },
  water: { 
    id: 'water', 
    name: 'Water / Ponding', 
    color: '#3b82f6', 
    height: 0.5, 
    shade: 0, 
    kc: 1.05, 
    albedo: 0.06, 
    nature: 1.0,
    roughness: 0.01,
    cost: 0,
    radius: 300 
  }
};

const INITIAL_PLANT_DEFS = {
    herbaceous: { name: 'Herbaceous', cost: 10 },
    bush: { name: 'Bush', cost: 18 },
    tree: { name: 'Tree', cost: 50 }
};

const INITIAL_LAYERS = [
    { id: 1, type: 'dirt', thickness: 0.3 },   // Top (Mulch)
    { id: 2, type: 'sand', thickness: 0.8 },   // Soil Media
    { id: 3, type: 'stone', thickness: 0.5 },  // Storage
];

const INITIAL_EXTRA_PARAMS = {
      surfaceSlope: 2.0,
      conductivitySlope: 10,
      suctionHead: 60
};

const ToolButton = ({ label, active, onClick, icon }) => (
  <button 
    onClick={onClick}
    className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all border ${
      active 
        ? 'bg-slate-800 text-white border-slate-800 shadow-md' 
        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50 hover:text-slate-700'
    }`}
  >
    {icon && <span className="text-base">{icon}</span>}
    {label}
  </button>
);

const ResultCard = ({ label, value, unit = '', subtext }) => (
  <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</div>
    <div className="text-2xl font-bold text-slate-800">
      {typeof value === 'number' ? value.toFixed(3) : value}
      <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>
    </div>
    {subtext && <div className="text-xs text-slate-500 mt-1">{subtext}</div>}
  </div>
);

const InputRow = ({ label, value, onChange, min = 0, max = 1, step = 0.01 }) => (
  <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
    <label className="text-sm text-slate-600">{label}</label>
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-20 px-2 py-1 text-right text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
    />
  </div>
);

// --- Main Application Component ---

const App = () => {
  // --- Voxel State ---
  const containerRef = useRef(null);
  const [mode, setMode] = useState('dig'); // 'dig', 'soil', 'surface', 'plant', 'prune', 'water'
  const [plantType, setPlantType] = useState('herbaceous');
  const [surfaceType, setSurfaceType] = useState('grass');
  
  // Layer State (Continuous thickness)
  const [layers, setLayers] = useState(INITIAL_LAYERS);

  const [extraParams, setExtraParams] = useState(INITIAL_EXTRA_PARAMS);

  // Voxel Grid State
  const [digMap, setDigMap] = useState(Array(GRID_UNITS).fill(0).map(() => Array(GRID_UNITS).fill(0)));
  const [plants, setPlants] = useState([]);
  const [surfaces, setSurfaces] = useState([]);
  const [waterMap, setWaterMap] = useState(Array(GRID_UNITS).fill(0).map(() => Array(GRID_UNITS).fill(false)));

  // Refs for Three.js
  const sceneRef = useRef(new THREE.Scene());
  const objectsRef = useRef([]); 
  const plantMeshesRef = useRef([]);

  // --- App State ---
  const [lulcDefs, setLulcDefs] = useState(INITIAL_LULC_DEFS);
  const [soilDefs, setSoilDefs] = useState(INITIAL_SOIL_DEFS);
  const [activeTab, setActiveTab] = useState('cooling');
  const [searchRadius, setSearchRadius] = useState(300);
  const [plantDefs, setPlantDefs] = useState(INITIAL_PLANT_DEFS);
  const [designName, setDesignName] = useState('New Rain Garden');

  const totalSoilHeight = useMemo(() => layers.reduce((sum, l) => sum + l.thickness, 0), [layers]);
  const totalSoilUnits = Math.ceil(totalSoilHeight / UNIT_SIZE_Y);

  // --- Voxel Logic ---
  const getVoxelColor = useCallback((yIndex) => {
    const heightFromBottom = yIndex * UNIT_SIZE_Y + UNIT_SIZE_Y / 2;
    let currentHeight = totalSoilHeight;
    for (const layer of layers) {
      const layerBottom = currentHeight - layer.thickness;
      if (heightFromBottom >= layerBottom) return soilDefs[layer.type] ? soilDefs[layer.type].color : '#000000';
      currentHeight = layerBottom;
    }
    return soilDefs.stone.color;
  }, [layers, totalSoilHeight, soilDefs]);

  const createPlantMesh = (type, position, plantId) => {
    const group = new THREE.Group();
    group.position.set(...position);
    const materials = {
      cactus: new THREE.MeshStandardMaterial({ color: '#2d5a27' }),
      trunk: new THREE.MeshStandardMaterial({ color: '#5d4037' }),
      leaves: new THREE.MeshStandardMaterial({ color: '#388e3c' }),
      flower: new THREE.MeshStandardMaterial({ color: '#e91e63' }),
      stem: new THREE.MeshStandardMaterial({ color: '#4caf50' }),
      grass: new THREE.MeshStandardMaterial({ color: '#4ade80' })
    };


    if (type === 'tree') {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 0.3), materials.trunk);
      t.position.y = 0.75; t.castShadow = true; group.add(t);
      const l = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 2.0), materials.leaves);
      l.position.y = 2.0; l.castShadow = true; group.add(l);
    } else if (type === 'bush') {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), materials.leaves);
      b.position.y = 0.25; b.castShadow = true; group.add(b);
    } else {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.05), materials.stem);
      s.position.y = 0.15; group.add(s);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), materials.flower);
      f.position.y = 0.35; f.castShadow = true; group.add(f);
    }

    group.traverse(c => { if (c.isMesh) c.userData = { isPlant: true, plantId }; });
    return group;
  };
  
  const handleThreeAction = (xUnits, zUnits) => {
    if (xUnits < 0 || xUnits >= GRID_UNITS || zUnits < 0 || zUnits >= GRID_UNITS) return;

    if (mode === 'dig') {
      const newDig = [...digMap.map(r => [...r])]; // Deep copy
      // Limit digging to the top layer thickness
      // Calculate max units allowed to be removed based on layer 0 thickness
      const topLayerThickness = layers[0].thickness; 
      const maxDigUnits = Math.floor(topLayerThickness / UNIT_SIZE_Y); 
      
      // Digging
      if (newDig[xUnits][zUnits] < maxDigUnits) {
        newDig[xUnits][zUnits] += 1;
        setDigMap(newDig);
        setPlants(prev => prev.filter(p => !(p.x === xUnits && p.z === zUnits)));
        setSurfaces(prev => prev.filter(p => !(p.x === xUnits && p.z === zUnits)));
        // Auto-fill with water
        const newWater = [...waterMap.map(row => [...row])];
        newWater[xUnits][zUnits] = true;
        setWaterMap(newWater);
      }
    } else if (mode === 'soil') {
      const newDig = [...digMap.map(r => [...r])];
      if (newDig[xUnits][zUnits] > 0) {
        newDig[xUnits][zUnits] -= 1;
        setDigMap(newDig);
        setPlants(prev => prev.filter(p => !(p.x === xUnits && p.z === zUnits)));
        setSurfaces(prev => prev.filter(p => !(p.x === xUnits && p.z === zUnits)));
        // Remove water if we filled it up? Optional, but safer.
        if (newDig[xUnits][zUnits] === 0) {
             const newWater = [...waterMap.map(row => [...row])];
             newWater[xUnits][zUnits] = false;
             setWaterMap(newWater);
        }
      }
    } else if (mode === 'plant') {
      // Allow only one plant per cell, remove existing
      setPlants(prev => [
        ...prev.filter(p => !(p.x === xUnits && p.z === zUnits)),
        { id: Math.random(), x: xUnits, z: zUnits, type: plantType }
      ]);
    } else if (mode === 'surface') {
       setSurfaces(prev => [
        ...prev.filter(p => !(p.x === xUnits && p.z === zUnits)),
        { id: Math.random(), x: xUnits, z: zUnits, type: surfaceType }
       ]);
       // Remove water if paving?
       const newWater = [...waterMap.map(row => [...row])];
       newWater[xUnits][zUnits] = false;
       setWaterMap(newWater);
    } else if (mode === 'prune') {
      const hasPlant = plants.some(p => p.x === xUnits && p.z === zUnits);
      if (hasPlant) {
         setPlants(prev => prev.filter(p => !(p.x === xUnits && p.z === zUnits)));
      } else {
         setSurfaces(prev => prev.filter(p => !(p.x === xUnits && p.z === zUnits)));
      }
    }
  };

  const handleCanvasClick = (event) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    const camera = sceneRef.current.userData.camera;
    if (!camera) return;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(objectsRef.current);
    if (intersects.length > 0) {
      const { xUnits, zUnits } = intersects[0].object.userData;
      handleThreeAction(xUnits, zUnits);
    }
  };

  // --- Three.js Lifecycle ---
  useEffect(() => {
    if(!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const scene = sceneRef.current;
    scene.background = new THREE.Color('#ffffff'); // White background for clean look

    const aspect = width / height;
    const d = 6;
    const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 1000);
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);
    scene.userData.camera = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    containerRef.current.innerHTML = ''; // Clear previous
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.target.set(0, 0, 0);

    scene.clear(); // Clear objects, but we re-add lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 12, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const animate = () => {
      // Basic loop, but we rely on React state updates to re-render scene objects conceptually,
      // but Three.js needs continuous render loop for controls
      requestAnimationFrame(animate); 
      controls.update();
      renderer.render(scene, camera);
    };
    const reqId = requestAnimationFrame(animate);

    const handleResize = () => {
        if(!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      const asp = w / h;
      camera.left = -d * asp; camera.right = d * asp; camera.top = d; camera.bottom = -d;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    
    // Capture current ref for cleanup
    const container = containerRef.current;

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(reqId);
      if (container && renderer.domElement) {
          container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // --- Sync State to Three.js ---
  useEffect(() => {
    const scene = sceneRef.current;
    
    // Clear old meshes
    objectsRef.current.forEach(o => scene.remove(o));
    objectsRef.current = [];
    plantMeshesRef.current.forEach(o => scene.remove(o));
    plantMeshesRef.current = [];

    const voxelGeo = new THREE.BoxGeometry(UNIT_SIZE_XZ * 0.95, UNIT_SIZE_Y * 0.95, UNIT_SIZE_XZ * 0.95);
    const waterMat = new THREE.MeshStandardMaterial({ color: WATER_DEF.color, transparent: true, opacity: 0.6 });


    // Rebuild Scene
    for (let x = 0; x < GRID_UNITS; x++) {
      for (let z = 0; z < GRID_UNITS; z++) {
        const unitsToRender = totalSoilUnits - digMap[x][z];
        const worldX = (x - GRID_UNITS / 2) * UNIT_SIZE_XZ + UNIT_SIZE_XZ / 2;
        const worldZ = (z - GRID_UNITS / 2) * UNIT_SIZE_XZ + UNIT_SIZE_XZ / 2;
        
        // Check for surface override
        const surfaceNode = surfaces.find(p => p.x === x && p.z === z);

        for (let y = 0; y < unitsToRender; y++) {
          let color = getVoxelColor(y);
          // If top voxel and has override, paint it
          if (y === unitsToRender - 1 && surfaceNode) {
              if (surfaceNode.type === 'grass') color = lulcDefs.grass ? lulcDefs.grass.color : '#4ade80'; 
              if (surfaceNode.type === 'concrete') color = lulcDefs.concrete ? lulcDefs.concrete.color : '#9ca3af';
          }
          
          const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.8 });
          const mesh = new THREE.Mesh(voxelGeo, mat);
          mesh.position.set(worldX, y * UNIT_SIZE_Y, worldZ);
          mesh.userData = { xUnits: x, zUnits: z };
          mesh.receiveShadow = true;
          mesh.castShadow = true;
          scene.add(mesh);
          objectsRef.current.push(mesh);
        }

        if (waterMap[x][z] && digMap[x][z] > 0) {
          // Fill the dug region with water voxels
          for(let w = unitsToRender; w < totalSoilUnits; w++) {
                 const wm = new THREE.Mesh(voxelGeo, waterMat);
                 wm.position.set(worldX, w * UNIT_SIZE_Y, worldZ);
                 wm.userData = { xUnits: x, zUnits: z };
                 scene.add(wm);
                 objectsRef.current.push(wm);
          }
        }
      }
    }

    plants.forEach(p => {
      if (p.type === 'grass' || p.type === 'concrete') return; // Surface types handled as voxel color

      const unitsToRender = totalSoilUnits - digMap[p.x][p.z];
      
      // Fix Floating:
      const topVoxelIndex = unitsToRender - 1;
      const voxelCenterY = topVoxelIndex * UNIT_SIZE_Y;
      const surfaceY = voxelCenterY + (UNIT_SIZE_Y * 0.95) / 2; 

      const worldX = (p.x - GRID_UNITS / 2) * UNIT_SIZE_XZ + UNIT_SIZE_XZ / 2;
      const worldZ = (p.z - GRID_UNITS / 2) * UNIT_SIZE_XZ + UNIT_SIZE_XZ / 2;
      
      // apply a tiny negative offset to bury it slightly to cover any seam
      const mesh = createPlantMesh(p.type, [worldX, surfaceY - 0.02, worldZ], p.id);
      scene.add(mesh);
      plantMeshesRef.current.push(mesh);
    });

  }, [plants, surfaces, digMap, waterMap, layers, totalSoilUnits, lulcDefs, getVoxelColor]);


  const handleParamChange = (id, field, value) => {
    setLulcDefs(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

  const handleSoilParamChange = (id, field, value) => {
    setSoilDefs(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };
  
  const updateLayer = (index, field, value) => {
    const newLayers = [...layers];
    newLayers[index][field] = field === 'thickness' ? parseFloat(value) : value;
    setLayers(newLayers);
  };

  const handleSave = () => {
    const data = {
      designName,
      digMap,
      plants,
      surfaces,
      layers,
      lulcDefs,
      soilDefs,
      plantDefs,
      extraParams,
      searchRadius,
      waterMap
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${designName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'rain-garden'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    // Construct simplified stats object
    const headers = [
        "GSI_Name",
        "Berm_Height_in",
        "Soil_Thickness_in",
        "Storage_Height_in",
        "Porosity",
        "Field_Capacity",
        "Wilting_Point",
        "Ksat_in_per_hr",
        "Suction_Head_in",
        "Conductivity_Slope",
        "Surface_Roughness_n",
        "Veg_Vol_Fraction",
        "Weighted_Albedo", 
        "Weighted_Kc", 
        "Weighted_Shade", 
        "Weighted_Nature",
        "Capital_Cost"
    ];

    const values = [
        designName,
        (swmmParams.bermHeight / 25.4).toFixed(3),
        (swmmParams.soilThickness / 25.4).toFixed(3),
        (swmmParams.storageHeight / 25.4).toFixed(3),
        swmmParams.porosity.toFixed(3),
        swmmParams.fieldCapacity.toFixed(3),
        swmmParams.wiltingPoint.toFixed(3),
        (swmmParams.ksat / 25.4).toFixed(3), // mm/hr to in/hr
        (swmmParams.suctionHead / 25.4).toFixed(3),
        swmmParams.conductivitySlope.toFixed(2),
        swmmParams.surfaceRoughness.toFixed(4),
        swmmParams.vegVolFraction.toFixed(3),
        stats.weightedAlbedo.toFixed(3),
        stats.weightedKc.toFixed(3),
        stats.weightedShade.toFixed(3),
        stats.weightedNature.toFixed(3),
        swmmParams.capitalCost.toFixed(2)
    ];

    const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n" 
        + values.join(",");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${designName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'rain-garden'}_params.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Use filename as default design name if not present in JSON
    const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        const missingData = [];

        if (data.designName) setDesignName(data.designName);
        else setDesignName(fileNameWithoutExt);

        if (data.digMap) setDigMap(data.digMap);
        else missingData.push("Terrain (digMap)");

        if (data.plants) setPlants(data.plants);
        else missingData.push("Plants");

        if (data.surfaces) setSurfaces(data.surfaces);
        else setSurfaces([]); // Reset surfaces if not present in file (compatibility)

        if (data.layers) setLayers(data.layers);
        else {
            setLayers(INITIAL_LAYERS);
            missingData.push("Layers Config");
        }

        if (data.lulcDefs) {
             // Merge with default to ensure new categories like 'concrete' exist if missing in old file
             setLulcDefs({ ...INITIAL_LULC_DEFS, ...data.lulcDefs });
        }
        else {
            setLulcDefs(INITIAL_LULC_DEFS); 
            missingData.push("Parameter Table (LULC)");
        }
        
        if (data.soilDefs) {
             setSoilDefs({ ...INITIAL_SOIL_DEFS, ...data.soilDefs });
        } else {
             setSoilDefs(INITIAL_SOIL_DEFS);
        }

        if (data.plantDefs) {
             setPlantDefs(data.plantDefs);
        } else if (data.plantPrices) {
             // Compatibility: Convert old simple price object to defs object
             const newDefs = { ...INITIAL_PLANT_DEFS };
             Object.entries(data.plantPrices).forEach(([key, val]) => {
                 if(newDefs[key]) newDefs[key].cost = val;
             });
             setPlantDefs(newDefs);
        } else {
             setPlantDefs(INITIAL_PLANT_DEFS);
             missingData.push("Plant Prices/Defs");
        }

        if (data.extraParams) setExtraParams(data.extraParams);
        else {
             setExtraParams(INITIAL_EXTRA_PARAMS);
             // Common to be missing in very old files, maybe don't warn unless strictly required
        }

        if (data.searchRadius) setSearchRadius(data.searchRadius);
        if (data.waterMap) setWaterMap(data.waterMap);
        else missingData.push("Water Map");

        if (missingData.length > 0) {
             const warningMsg = `Loaded with warnings: Some data components were missing in this file (${missingData.join(', ')}). Default values have been used where valid.`;
             console.warn(warningMsg);
             alert(warningMsg);
        }

      } catch (err) {
        console.error("Failed to parse file", err);
        alert("Invalid file format");
      }
    };
    reader.readAsText(file);
  };

  // Calculations
  const stats = useMemo(() => {
    let counts = { mulch: 0, grass: 0, bush: 0, forest: 0, water: 0, concrete: 0 };
    const trees = plants.filter(p => p.type === 'tree');
    
    for (let x = 0; x < GRID_UNITS; x++) {
        for (let z = 0; z < GRID_UNITS; z++) {
            let type = null;
            
            // Top Cover: Tree Canopy (Radius ~1m = 2 units)
            const isUnderTree = trees.some(t => ((t.x - x)**2 + (t.z - z)**2) <= 4);

            // 1. Top-Down Cover Priority
            // Forest > Bush > Herbaceous > Water > Surface
            
            const plant = plants.find(p => p.x === x && p.z === z);
            
            if (isUnderTree) {
                type = 'forest';
            } else if (plant && (plant.type === 'bush' || plant.type === 'cactus')) {
                type = 'bush';
            } else if (plant && (plant.type === 'herbaceous' || plant.type === 'flower' || plant.type === 'grass')) {
                type = 'grass';
            } else if (waterMap[x][z]) {
                type = 'water';
            } else {
                 const surface = surfaces.find(s => s.x === x && s.z === z);
                 if (surface) {
                     type = surface.type;
                 } else {
                         // Default to Soil
                         const unitsToRender = totalSoilUnits - digMap[x][z];
                    if (unitsToRender > 0) {
                        const topVoxelY = unitsToRender - 1;
                        
                        // Re-implement simplified layer check for type:
                        const heightFromBottom = topVoxelY * UNIT_SIZE_Y + UNIT_SIZE_Y / 2;
                        let currentHeight = totalSoilHeight;
                        let surfaceType = 'stone';
                        for (const layer of layers) {
                            const layerBottom = currentHeight - layer.thickness;
                            if (heightFromBottom >= layerBottom) {
                                surfaceType = layer.type;
                                break;
                            }
                            currentHeight = layerBottom;
                        }
                        
                        if (surfaceType === 'grass') type = 'grass';
                        else type = 'mulch'; // All other soils map to Mulch/Soil
                    } else {
                        // Empty hole
                        type = 'mulch'; 
                    }
                }
            }
        if (type && counts[type] !== undefined) counts[type]++;
        }
    }

    // Calculate Weighted Averages
    let weightedAlbedo = 0;
    let weightedKc = 0;
    let weightedShade = 0;
    let weightedNature = 0;
    let weightedRadius = 0;

    Object.keys(counts).forEach(key => {
      const weight = counts[key] / TOTAL_CELLS;
      const def = lulcDefs[key];
      if (def) {
          weightedAlbedo += weight * def.albedo;
          weightedKc += weight * def.kc;
          weightedShade += weight * def.shade;
          weightedNature += weight * def.nature;
          weightedRadius += weight * (def.radius !== undefined ? def.radius : 300);
      }
    });

    return { counts, weightedAlbedo, weightedKc, weightedShade, weightedNature, weightedRadius };
  }, [digMap, plants, surfaces, waterMap, lulcDefs, layers, totalSoilUnits, totalSoilHeight]);

  // SWMM Parameters Calculation
  const swmmParams = useMemo(() => {
    // 1. Surface Layer
    // Berm Height: Max depth of digging.
    let maxDig = 0;
    digMap.forEach(row => row.forEach(val => maxDig = Math.max(maxDig, val)));
    const bermHeight = maxDig * UNIT_SIZE_Y * 1000; // mm

    // Surface Roughness (Manning's n)
    // Weighted by surface composition count (from stats.counts)
    const total = TOTAL_CELLS;
    let n_weighted = 0;
    Object.keys(stats.counts).forEach(key => {
        if(lulcDefs[key]) {
            n_weighted += stats.counts[key] * lulcDefs[key].roughness;
        }
    });
    n_weighted /= total;

    // Vegetation Volume
    // Simplified: Fraction of total cells that are planted
    const plantedCells = plants.length;
    const vegVolFraction = Math.min(plantedCells / TOTAL_CELLS, 1.0);

    // 2. Soil Layer & Storage Layer
    let soilThickness = 0;
    let storageThickness = 0;
    let thicknessWeightedProps = { porosity: 0, fc: 0, wp: 0, ksat: 0, slope: 10, suction: 50 };
    let totalSoilThick = 0;
    
    // Calculate Capital Cost
    // Soil Volume Cost + Plants Cost
    // Assume Soil ~$30/m3, Stone ~$50/m3
    
    let plantsCost = 0;
    plants.forEach(p => {
        plantsCost += plantDefs[p.type]?.cost || 0;
    });

    surfaces.forEach(s => {
        const def = lulcDefs[s.type];
        if (def && def.cost) {
            plantsCost += def.cost * (UNIT_SIZE_XZ * UNIT_SIZE_XZ); // Cost per m2 * area per block
        }
    });

    // Add Water Cost
    let waterCount = 0;
    waterMap.forEach(row => row.forEach(val => { if(val) waterCount++; }));
    if(lulcDefs['water'] && lulcDefs['water'].cost) {
         plantsCost += waterCount * (UNIT_SIZE_XZ * UNIT_SIZE_XZ) * lulcDefs['water'].cost;
    }

    let materialCost = 0;
    const DESIGN_AREA = BOUNDARY_SIZE * BOUNDARY_SIZE;

    layers.forEach(l => {
        const def = soilDefs[l.type] || soilDefs.dirt;
        const vol = l.thickness * DESIGN_AREA;
        // Cost = Volume * Unit Cost
        materialCost += vol * (def.cost || 0);

        if (l.type === 'stone') {
            storageThickness += l.thickness;
        } else {
            soilThickness += l.thickness;
            totalSoilThick += l.thickness;
            
            const p = def;
            thicknessWeightedProps.porosity += p.porosity * l.thickness;
            thicknessWeightedProps.fc += p.fc * l.thickness;
            thicknessWeightedProps.wp += p.wp * l.thickness;
            thicknessWeightedProps.ksat += p.ksat * l.thickness;
        }
    });

    // Normalize weighted props
    if (totalSoilThick > 0) {
        thicknessWeightedProps.porosity /= totalSoilThick;
        thicknessWeightedProps.fc /= totalSoilThick;
        thicknessWeightedProps.wp /= totalSoilThick;
        thicknessWeightedProps.ksat /= totalSoilThick;
    }
    
    return {
        bermHeight,
        vegVolFraction,
        surfaceRoughness: n_weighted,
        surfaceSlope: extraParams.surfaceSlope, 
        soilThickness: soilThickness * 1000, // mm
        porosity: thicknessWeightedProps.porosity,
        fieldCapacity: thicknessWeightedProps.fc,
        wiltingPoint: thicknessWeightedProps.wp,
        ksat: thicknessWeightedProps.ksat,
        conductivitySlope: extraParams.conductivitySlope,
        suctionHead: extraParams.suctionHead,
        storageHeight: storageThickness * 1000, // mm
        capitalCost: plantsCost + materialCost
    };

  }, [digMap, plants, layers, stats, extraParams, lulcDefs, plantDefs, soilDefs]);

  // Tab Content Renderers
  const renderCoolingTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg flex gap-3">
        <Wind className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />
        <div>
          <h3 className="font-semibold text-blue-900 text-sm">Urban Cooling Model (InVEST)</h3>
          <p className="text-xs text-blue-700 mt-1">
            Calculates weighted average parameters based on the voxel composition of your rain garden.
            Adjust the base parameters below to refine the material properties.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ResultCard label="Weighted Albedo" value={stats.weightedAlbedo} subtext="Target: ~0.12" />
        <ResultCard label="Weighted Kc" value={stats.weightedKc} subtext="Target: ~0.95" />
        <ResultCard label="Weighted Shade" value={stats.weightedShade} subtext="Canopy Cover" />
      </div>

      <div className="bg-blue-50/50 p-4 rounded-lg text-center border border-blue-100">
         <p className="text-xs text-blue-800">
             To adjust the base values for Albedo, Kc, etc., please switch to the <strong>Parameters</strong> tab.
         </p>
      </div>
    </div>
  );

  const renderNatureTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-lg flex gap-3">
        <Sprout className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-1" />
        <div>
          <h3 className="font-semibold text-emerald-900 text-sm">Urban Nature Access (2SFCA)</h3>
          <p className="text-xs text-emerald-700 mt-1">
            Calculates the 'naturalness' of the intervention. The search radius is a weighted average based on the LULC composition.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ResultCard 
          label="Urban Nature (Ratio)" 
          value={stats.weightedNature} 
          unit="/ 1.0"
          subtext="Weighted Sum of Naturalness" 
        />
        <ResultCard 
          label="Search Radius" 
          value={stats.weightedRadius} 
          unit="m"
          subtext="Weighted Average Radius" 
        />
      </div>

      <div className="bg-emerald-50/50 p-4 rounded-lg text-center border border-emerald-100">
         <p className="text-xs text-emerald-800">
             To adjust the Naturalness scores for each land cover type, please switch to the <strong>Parameters</strong> tab.
         </p>
      </div>
    </div>
  );

  const renderSWMMTab = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-lg flex gap-3">
        <Database className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-1" />
        <div>
          <h3 className="font-semibold text-indigo-900 text-sm">SWMM LID Control Parameters</h3>
          <p className="text-xs text-indigo-700 mt-1">
            Parameters calculated from your 3D design geometry and material composition.
            These values can be directly input into EPA SWMM 5.1 LID Editor.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Surface Layer */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
             <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 font-bold text-xs text-slate-500 uppercase">Surface Layer</div>
             <div className="p-4 space-y-3">
                <ResultCard label="Berm Height" value={swmmParams.bermHeight / 25.4} unit="in" subtext="Max depth" />
                <div className="space-y-2 pt-2">
                    <InputRow label="Veg. Volume Fraction" value={swmmParams.vegVolFraction.toFixed(2)} onChange={()=>{}} />
                    <InputRow label="Surface Roughness (n)" value={swmmParams.surfaceRoughness.toFixed(3)} onChange={()=>{}} />
                    <InputRow label="Surface Slope (%)" value={swmmParams.surfaceSlope} onChange={(v)=>setExtraParams(p => ({...p, surfaceSlope: v}))} />
                </div>
             </div>
          </div>

          {/* Soil Layer */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
             <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 font-bold text-xs text-slate-500 uppercase">Soil media</div>
             <div className="p-4 space-y-3">
                <ResultCard label="Thickness" value={swmmParams.soilThickness / 25.4} unit="in" subtext="Sum of Soil Layers" />
                <div className="space-y-2 pt-2">
                    <InputRow label="Porosity" value={swmmParams.porosity.toFixed(2)} onChange={()=>{}} />
                    <InputRow label="Field Capacity" value={swmmParams.fieldCapacity.toFixed(2)} onChange={()=>{}} />
                    <InputRow label="Wilting Point" value={swmmParams.wiltingPoint.toFixed(2)} onChange={()=>{}} />
                    <InputRow label="Ksat (in/hr)" value={(swmmParams.ksat / 25.4).toFixed(2)} onChange={()=>{}} />
                    <InputRow label="Conductivity Slope" value={swmmParams.conductivitySlope} onChange={(v)=>setExtraParams(p => ({...p, conductivitySlope: v}))} />
                    <InputRow label="Suction Head (in)" value={(swmmParams.suctionHead / 25.4).toFixed(2)} onChange={(v)=>setExtraParams(p => ({...p, suctionHead: v * 25.4}))} />
                </div>
             </div>
          </div>

           {/* Storage Layer */}
           <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
             <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 font-bold text-xs text-slate-500 uppercase">Storage / Drain</div>
             <div className="p-4 space-y-3">
                <ResultCard label="Storage Height" value={swmmParams.storageHeight / 25.4} unit="in" subtext="Sum of Stone Layers" />
                 {/* Drain parameters usually fixed unless logic added */}
             </div>
          </div>

          {/* Costs */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
             <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 font-bold text-xs text-slate-500 uppercase">Estimated Costs</div>
             <div className="p-4 flex flex-col justify-center h-full space-y-2">
                <div>
                    <div className="text-3xl font-bold text-green-600">${Math.round(swmmParams.capitalCost).toLocaleString()}</div>
                    <div className="text-xs text-slate-500">Total Capital Cost (Surface & Plants)</div>
                </div>
                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-2">
                     <div>
                        <div className="text-lg font-bold text-slate-700">${(swmmParams.capitalCost / 25).toFixed(2)}</div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Per m²</div>
                     </div>
                     <div>
                        <div className="text-lg font-bold text-slate-700">${(swmmParams.capitalCost / (25 * 10.764)).toFixed(2)}</div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold">Per ft²</div>
                     </div>
                </div>
             </div>
          </div>

      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Multifunctional GSI Design Portal</h1>
            <p className="text-slate-500 mt-1">Converting GI designs to model parameters for multifunctionality evaluation</p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT COLUMN: Visual Editor */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* 3D Canvas */}
            <div className="bg-slate-900 p-0 rounded-2xl shadow-sm border border-slate-700 relative overflow-hidden group min-h-[500px] flex flex-col">
               <div ref={containerRef} className="w-full h-[500px]" onClick={handleCanvasClick} />
               <div className="absolute top-4 left-4 z-10 w-64 max-w-[50%]">
                 <input 
                   value={designName}
                   onChange={(e) => setDesignName(e.target.value)}
                   className="bg-black/50 hover:bg-black/70 focus:bg-black/80 text-white font-bold text-sm uppercase tracking-widest px-3 py-1.5 rounded backdrop-blur-sm border border-white/10 outline-none w-full transition-all placeholder-white/30"
                   placeholder="DESIGN NAME"
                 />
               </div>
               <div className="absolute bottom-4 right-4 text-xs text-white/50 pointer-events-none">Click to Edit • Drag to Rotate</div>
            </div>

            {/* Voxel Controls */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-4">
               
               <div className="flex justify-between items-start">
                   {/* Modes */}
                   <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Editor Tools</h4>
                      <div className="flex gap-2 flex-wrap">
                          {['dig', 'soil', 'surface', 'plant', 'prune'].map(m => (
                              <ToolButton 
                                 key={m} 
                                 label={m === 'dig' ? 'Dig & Water' : m} 
                                 active={mode === m} 
                                 onClick={() => setMode(m)} 
                              />
                          ))}
                      </div>
                   </div>

                    {/* File Operations */}
                   <div className="flex gap-2">
                        <button onClick={() => {
                           if(window.confirm('Start a new design? All unsaved progress will be lost.')) {
                               setDigMap(Array(GRID_UNITS).fill(0).map(() => Array(GRID_UNITS).fill(0)));
                               setPlants([]);
                               setSurfaces([]);
                               setWaterMap(Array(GRID_UNITS).fill(0).map(() => Array(GRID_UNITS).fill(false)));
                               setDesignName('New Rain Garden');
                           }
                        }} className="p-2 text-slate-500 hover:text-red-600 transition-colors" title="New Design">
                             <Leaf className="w-5 h-5" />
                        </button>
                        <button onClick={handleSave} className="p-2 text-slate-500 hover:text-blue-600 transition-colors" title="Save Design">
                            <Database className="w-5 h-5" />
                        </button>
                        <button onClick={handleExportCSV} className="p-2 text-slate-500 hover:text-green-600 transition-colors" title="Export CSV">
                             <Layers className="w-5 h-5" />
                        </button>
                        <label className="p-2 text-slate-500 hover:text-yellow-600 transition-colors cursor-pointer" title="Load Design">
                             <span className="text-xl leading-none">📂</span>
                             <input type="file" accept=".json" onChange={handleLoad} className="hidden" />
                        </label>
                   </div>
               </div>

                {/* Plant Type Selector */}
                {mode === 'plant' && (
                    <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                      <h4 className="text-xs font-bold text-green-700 uppercase mb-2">Plant Species</h4>
                      <div className="flex gap-2">
                         {['herbaceous', 'bush', 'tree'].map(t => (
                             <ToolButton 
                                key={t} 
                                label={plantDefs[t]?.name || t}
                                active={plantType === t}
                                onClick={() => setPlantType(t)}
                                icon={t === 'herbaceous' ? '🌸' : t === 'bush' ? '🌿' : '🌳'}
                             />
                         ))}
                      </div>
                      <div className="mt-2 text-xs text-green-600 italic">
                         {plantType === 'tree' ? 'Counts as Forest/Tree cover.' 
                          : plantType === 'bush' ? 'Counts as Bush/Shrub cover.'
                          : 'Counts as Grass/Herbaceous cover.'}
                      </div>
                    </div>
                )}
                
                {/* Surface Type Selector */}
                {mode === 'surface' && (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <h4 className="text-xs font-bold text-slate-700 uppercase mb-2">Surface Material</h4>
                      <div className="flex gap-2">
                         {['grass', 'concrete'].map(t => (
                             <ToolButton 
                                key={t} 
                                label={t === 'grass' ? 'Turf' : 'Concrete'}
                                active={surfaceType === t}
                                onClick={() => setSurfaceType(t)}
                                icon={t === 'grass' ? '🌱' : '⬜'}
                             />
                         ))}
                      </div>
                      <div className="mt-2 text-xs text-slate-600 italic">
                         {surfaceType === 'grass' ? 'Turf counts as Grassland.' : 'Concrete counts as Paved/Impervious.'}
                      </div>
                    </div>
                )}
                
                {/* Layer Config */}
                <div className="mt-4 pt-4 border-t border-slate-100">
                   <div className="flex justify-between items-center mb-3">
                       <h4 className="text-xs font-bold text-slate-400 uppercase">Soil Layers</h4>
                       <div className="flex gap-1">
                           <button 
                               onClick={() => setLayers(l => [...l, { id: Math.random(), type: 'dirt', thickness: 0.3 }])}
                               className="px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 text-xs font-bold"
                           >
                               +
                           </button>
                           <button 
                               onClick={() => setLayers(l => l.slice(0, -1))}
                               disabled={layers.length <= 1}
                               className="px-2 py-1 bg-slate-50 text-slate-600 rounded hover:bg-red-50 hover:text-red-600 text-xs font-bold disabled:opacity-50"
                           >
                               -
                           </button>
                       </div>
                   </div>
                   <div className="space-y-2">
                      {layers.map((layer, idx) => (
                          <div key={layer.id} className="flex items-center gap-2 text-xs bg-slate-50 p-2 rounded border border-slate-100">
                             <span className="font-bold text-slate-500 w-6">L{idx+1}</span>
                             <select 
                                value={layer.type} 
                                onChange={(e) => updateLayer(idx, 'type', e.target.value)}
                                className="bg-white border border-slate-200 rounded px-2 py-1 flex-1 min-w-0"
                             >
                                {Object.keys(soilDefs).map(k => (
                                  <option key={k} value={k}>{soilDefs[k].name}</option>
                                ))}
                             </select>
                             <div className="flex items-center gap-1">
                                 <input 
                                   type="number" step="0.1" min="0.1"
                                   // Convert meters to inches for display. 1m = 39.3701 inches
                                   value={(layer.thickness * 39.3701).toFixed(2)}
                                   onChange={(e) => updateLayer(idx, 'thickness', parseFloat(e.target.value) / 39.3701)}
                                   className="w-16 px-2 py-1 border border-slate-200 rounded text-right"
                                 />
                                 <span className="text-slate-400">in</span>
                             </div>
                          </div>
                      ))}
                   </div>
                </div>

            </div>

            {/* Composition Stats */}
             <div className="bg-white p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Model Composition Breakdown</h4>
                <div className="flex h-4 rounded-full overflow-hidden w-full bg-slate-100">
                    {Object.entries(stats.counts).map(([key, count]) => (
                        count > 0 && (
                            <div 
                                key={key}
                                style={{ width: `${(count/TOTAL_CELLS)*100}%`, backgroundColor: lulcDefs[key].color }}
                                className="h-full transition-all duration-500"
                                title={`${lulcDefs[key].name}: ${(count/TOTAL_CELLS)*100}%`}
                            />
                        )
                    ))}
                </div>
                <div className="flex flex-wrap gap-4 mt-3">
                    {Object.entries(stats.counts).map(([key, count]) => (
                         count > 0 && (
                             <div key={key} className="flex items-center gap-2 text-xs text-slate-600">
                                 <div className="w-2 h-2 rounded-full" style={{backgroundColor: lulcDefs[key].color}}></div>
                                 <span>{Math.round((count/TOTAL_CELLS)*100)}% {lulcDefs[key].name}</span>
                             </div>
                         )
                    ))}
                </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Configuration Tabs */}
          <div className="lg:col-span-7 flex flex-col">
            
            {/* Tab Navigation */}
            <div className="flex gap-2 border-b border-slate-200 mb-6">
              <button
                onClick={() => setActiveTab('cooling')}
                className={`pb-3 px-4 text-sm font-medium transition-colors relative ${
                  activeTab === 'cooling' 
                    ? 'text-blue-600' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className="flex items-center gap-2"><Sun className="w-4 h-4"/> Urban Cooling</span>
                {activeTab === 'cooling' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full"></div>}
              </button>
              
              <button
                onClick={() => setActiveTab('nature')}
                className={`pb-3 px-4 text-sm font-medium transition-colors relative ${
                  activeTab === 'nature' 
                    ? 'text-emerald-600' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className="flex items-center gap-2"><Trees className="w-4 h-4"/> Nature Access</span>
                {activeTab === 'nature' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600 rounded-t-full"></div>}
              </button>

              <button
                onClick={() => setActiveTab('swmm')}
                className={`pb-3 px-4 text-sm font-medium transition-colors relative ${
                  activeTab === 'swmm' 
                    ? 'text-indigo-600' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className="flex items-center gap-2"><Droplets className="w-4 h-4"/> SWMM Config</span>
                {activeTab === 'swmm' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full"></div>}
              </button>

              <button
                onClick={() => setActiveTab('params')}
                className={`pb-3 px-4 text-sm font-medium transition-colors relative ${
                  activeTab === 'params' 
                    ? 'text-slate-900' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className="flex items-center gap-2"><Settings className="w-4 h-4"/> Parameters</span>
                {activeTab === 'params' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900 rounded-t-full"></div>}
              </button>
            </div>

            {/* Tab Body */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex-grow">
               {activeTab === 'cooling' && renderCoolingTab()}
               {activeTab === 'nature' && renderNatureTab()}
               {activeTab === 'swmm' && renderSWMMTab()}
               {activeTab === 'params' && (
                   <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg flex gap-3">
                         <Settings className="w-5 h-5 text-slate-600 flex-shrink-0 mt-1" />
                         <div>
                            <h3 className="font-semibold text-slate-900 text-sm">Parameter Library</h3>
                            <p className="text-xs text-slate-500 mt-1">
                               Configure base parameters for Land Use / Land Cover (LULC) types and Plant Costs. 
                               These values drive the calculations in other tabs.
                            </p>
                         </div>
                      </div>

                      {/* LULC Config */}
                      <div className="bg-white border text-sm rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 font-bold text-slate-700">
                          Land Cover Parameters
                        </div>
                        <div className="p-0 overflow-x-auto">
                           <table className="w-full text-left">
                             <thead className="bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-100">
                                <tr>
                                  <th className="px-4 py-3">Type</th>
                                  <th className="px-4 py-3 text-right">Albedo</th>
                                  <th className="px-4 py-3 text-right">Kc (Et)</th>
                                  <th className="px-4 py-3 text-right">Shade</th>
                                  <th className="px-4 py-3 text-right">Nature</th>
                                  <th className="px-4 py-3 text-right">Roughness</th>
                                  <th className="px-4 py-3 text-right">Radius (m)</th>
                                  <th className="px-4 py-3 text-right">Cost ($/m²)</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100">
                               {Object.values(lulcDefs).map((def) => (
                                 <tr key={def.id} className="hover:bg-slate-50">
                                   <td className="px-4 py-2 font-medium bg-white text-slate-700 flex items-center gap-2">
                                     <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: def.color }}></div>
                                     {def.name}
                                   </td>
                                   <td className="px-2 py-2"><input type="number" step="0.01" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors" value={def.albedo} onChange={(e) => handleParamChange(def.id, 'albedo', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="0.01" min="0" max="2" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors" value={def.kc} onChange={(e) => handleParamChange(def.id, 'kc', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="0.1" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors" value={def.shade} onChange={(e) => handleParamChange(def.id, 'shade', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="0.1" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors" value={def.nature} onChange={(e) => handleParamChange(def.id, 'nature', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="0.01" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors" value={def.roughness} onChange={(e) => handleParamChange(def.id, 'roughness', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="10" min="0" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors" value={def.radius} onChange={(e) => handleParamChange(def.id, 'radius', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2">
                                      {['grass', 'concrete', 'water'].includes(def.id) ? (
                                        <input type="number" step="1" min="0" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors font-bold text-slate-700" value={def.cost} onChange={(e) => handleParamChange(def.id, 'cost', parseFloat(e.target.value))} />
                                      ) : (
                                        <div className="w-full text-right text-slate-400 italic text-xs pt-1">See below</div>
                                      )}
                                   </td>
                                 </tr>
                               ))}
                             </tbody>
                           </table>
                        </div>
                      </div>

                      {/* Soil Param Config */}
                      <div className="bg-white border text-sm rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 font-bold text-slate-700">
                          Soil Hydrology Parameters
                        </div>
                        <div className="p-0 overflow-x-auto">
                           <table className="w-full text-left">
                             <thead className="bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-100">
                                <tr>
                                  <th className="px-4 py-3">Soil Type</th>
                                  <th className="px-4 py-3 text-right">Porosity</th>
                                  <th className="px-4 py-3 text-right">Field Cap.</th>
                                  <th className="px-4 py-3 text-right">Wilt Pt.</th>
                                  <th className="px-4 py-3 text-right">Ksat (in/hr)</th>
                                  <th className="px-4 py-3 text-right">Suction (in)</th>
                                  <th className="px-4 py-3 text-right">Slope</th>
                                  <th className="px-4 py-3 text-right">Cost ($/ft³)</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100">
                               {Object.entries(soilDefs).map(([key, def]) => (
                                 <tr key={key} className="hover:bg-slate-50">
                                   <td className="px-4 py-2 font-medium bg-white text-slate-700 flex items-center gap-2">
                                     <div className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: def.color }}></div>
                                     <input 
                                       type="text" 
                                       value={def.name}
                                       onChange={(e) => handleSoilParamChange(key, 'name', e.target.value)}
                                       className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none transition-colors w-32"
                                     />
                                   </td>
                                   <td className="px-2 py-2"><input type="number" step="0.01" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none" value={def.porosity} onChange={(e) => handleSoilParamChange(key, 'porosity', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="0.01" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none" value={def.fc} onChange={(e) => handleSoilParamChange(key, 'fc', parseFloat(e.target.value))} /></td>
                                   <td className="px-2 py-2"><input type="number" step="0.01" min="0" max="1" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none" value={def.wp} onChange={(e) => handleSoilParamChange(key, 'wp', parseFloat(e.target.value))} /></td>
                                   
                                   {/* Ksat: mm/hr -> in/hr */}
                                   <td className="px-2 py-2"><input type="number" step="0.1" min="0" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none" value={(def.ksat / 25.4).toFixed(2)} onChange={(e) => handleSoilParamChange(key, 'ksat', parseFloat(e.target.value) * 25.4)} /></td>
                                   
                                   {/* Suction: mm -> in */}
                                   <td className="px-2 py-2"><input type="number" step="0.1" min="0" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none" value={(def.suction / 25.4).toFixed(2)} onChange={(e) => handleSoilParamChange(key, 'suction', parseFloat(e.target.value) * 25.4)} /></td>

                                   <td className="px-2 py-2"><input type="number" step="1" min="0" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none" value={def.kslope} onChange={(e) => handleSoilParamChange(key, 'kslope', parseFloat(e.target.value))} /></td>
                                   
                                   {/* Cost: $/m3 -> $/ft3. 1 m3 = 35.3147 ft3. */}
                                   <td className="px-2 py-2"><input type="number" step="0.1" min="0" className="w-full text-right bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none font-bold text-slate-700" value={(def.cost / 35.3147).toFixed(2)} onChange={(e) => handleSoilParamChange(key, 'cost', parseFloat(e.target.value) * 35.3147)} /></td>
                                 </tr>
                               ))}
                             </tbody>
                           </table>
                        </div>
                      </div>

                      {/* Plant Price Config */}
                      <div className="bg-white border text-sm rounded-xl overflow-hidden shadow-sm">
                        <div className="bg-slate-100 px-4 py-3 border-b border-slate-200 font-bold text-slate-700">
                          Plant Config (Name | Unit Cost $)
                        </div>
                        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {Object.entries(plantDefs).map(([key, def]) => {
                                const count = plants.filter(p => p.type === key).length;
                                return (
                                <div key={key} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                   <div className="flex justify-between items-center mb-1">
                                      <div className="text-xs font-bold text-slate-400 uppercase">{key}</div>
                                      <div title="Count in design" className={`text-xs font-bold ${count > 0 ? 'text-blue-600' : 'text-slate-300'}`}>x{count}</div>
                                   </div>
                                   <input 
                                      type="text"
                                      value={def.name}
                                      onChange={(e) => setPlantDefs(prev => ({...prev, [key]: {...prev[key], name: e.target.value}}))}
                                      className="w-full bg-transparent text-sm font-semibold mb-1 border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none"
                                   />
                                   <div className="flex items-center">
                                       <span className="text-slate-500 mr-1">$</span>
                                       <input 
                                          type="number" 
                                          value={def.cost} 
                                          onChange={(e) => setPlantDefs(prev => ({...prev, [key]: {...prev[key], cost: parseFloat(e.target.value)}}))}
                                          className="w-full bg-transparent font-bold text-slate-700 outline-none border-b border-transparent focus:border-green-500"
                                       />
                                   </div>
                                </div>
                            )})}
                        </div>
                      </div>
                   </div>
               )}
            </div>
            
            {/* Info Footer */}
            <div className="mt-4 flex gap-2 items-start p-3 bg-yellow-50 text-yellow-800 text-xs rounded-lg border border-yellow-100">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p>
                    <strong>Note on Models:</strong> Weighted averages assume a linear relationship for Albedo, Kc, and Nature Score. 
                    Search Radius is treated as a fixed site parameter. Shade is calculated as average canopy cover percentage.
                </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default App;