/**
 * 생물 계통분류 웹앱
 * 노드 기반 그래프 뷰, 부모-자식 관계, 자유로운 분류단계 지원
 */

// ============================================
// 1. 상태 관리 & 초기화
// ============================================

let state = {
    nodes: [],           // {id, name, taxonomyLevel, description, color, parentIds}
    taxonomyLevels: [],  // 분류 단계 리스트
    selectedNodeId: null,
    nodePositions: {},   // {nodeId: {x, y}} - 레이아웃
    nodeVelocities: {},  // {nodeId: {vx, vy}} - 속도 (반발력용)
    viewTransform: { x: 0, y: 0, scale: 1 }, // 카메라 위치 및 줌
    settings: {
        panSensitivity: 1.0,
        repulsionForce: 1.0,
        repulsionDistance: 200,
        springStrength: 1.0,
        nodeSize: 30,
        linkWidth: 2,
        showArrows: true,
    },
};

const STORAGE_KEY = 'biologicalTaxonomy';
const SETTINGS_KEY = 'biologicalTaxonomySettings';
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 1500;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const REPULSION_FRICTION = 0.85; // 반발력 감속 (physics damping)

/**
 * 샘플 데이터 초기화
 */
function initSampleData() {
    const levels = ['계', '문', '강', '목', '과', '속', '종'];
    state.taxonomyLevels = levels;

    state.nodes = [
        { id: '1', name: '생물', taxonomyLevel: '계', description: '모든 생물', color: '#e74c3c', parentIds: [] },
        { id: '2', name: '동물계', taxonomyLevel: '계', description: '동물 계열', color: '#e67e22', parentIds: [] },
        { id: '3', name: '척삭동물문', taxonomyLevel: '문', description: '척동물', color: '#3498db', parentIds: ['2'] },
        { id: '4', name: '포유강', taxonomyLevel: '강', description: '포유 동물', color: '#9b59b6', parentIds: ['3'] },
        { id: '5', name: '영장목', taxonomyLevel: '목', description: '영장류', color: '#1abc9c', parentIds: ['4'] },
        { id: '6', name: '호미니과', taxonomyLevel: '과', description: '인간과', color: '#f39c12', parentIds: ['5'] },
        { id: '7', name: '호모속', taxonomyLevel: '속', description: '인간 속', color: '#34495e', parentIds: ['6'] },
        { id: '8', name: '호모 사피엔스', taxonomyLevel: '종', description: '현대인간', color: '#c0392b', parentIds: ['7'] },
        { id: '9', name: '절지동물문', taxonomyLevel: '문', description: '곤충, 거미 등', color: '#16a085', parentIds: ['2'] },
        { id: '10', name: '곤충강', taxonomyLevel: '강', description: '곤충', color: '#27ae60', parentIds: ['9'] },
    ];

    // 레이아웃 초기화 (원형)
    const angleStep = (Math.PI * 2) / state.nodes.length;
    const radius = 300;
    state.nodes.forEach((node, index) => {
        const angle = angleStep * index;
        state.nodePositions[node.id] = {
            x: CANVAS_WIDTH / 2 + radius * Math.cos(angle),
            y: CANVAS_HEIGHT / 2 + radius * Math.sin(angle),
        };
        // 속도 초기화
        state.nodeVelocities[node.id] = { vx: 0, vy: 0 };
    });

    saveToLocalStorage();
    render();
}

/**
 * localStorage에서 상태 로드
 */
function loadFromLocalStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            const parsed = JSON.parse(data);
            state.nodes = parsed.nodes || [];
            state.taxonomyLevels = parsed.taxonomyLevels || [];
            state.nodePositions = parsed.nodePositions || {};

            // 이전 단일 parentId를 parentIds 배열로 변환 (하위호환성)
            state.nodes.forEach((node) => {
                if (!state.nodePositions[node.id]) {
                    state.nodePositions[node.id] = {
                        x: Math.random() * CANVAS_WIDTH,
                        y: Math.random() * CANVAS_HEIGHT,
                    };
                }
                // 속도 초기화
                if (!state.nodeVelocities[node.id]) {
                    state.nodeVelocities[node.id] = { vx: 0, vy: 0 };
                }
                // 단일 parentId를 배열로 변환
                if (node.parentId && !node.parentIds) {
                    node.parentIds = [node.parentId];
                    delete node.parentId;
                } else if (!node.parentIds) {
                    node.parentIds = [];
                }
            });
            return true;
        }
    } catch (e) {
        console.error('localStorage 로드 실패:', e);
    }
    return false;
}

/**
 * localStorage에 상태 저장
 */
function saveToLocalStorage() {
    try {
        const data = {
            nodes: state.nodes,
            taxonomyLevels: state.taxonomyLevels,
            nodePositions: state.nodePositions,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('localStorage 저장 실패:', e);
    }
}

/**
 * 설정 로드
 */
function loadSettings() {
    try {
        const data = localStorage.getItem(SETTINGS_KEY);
        if (data) {
            const parsed = JSON.parse(data);
            state.settings = { ...state.settings, ...parsed };
        }
    } catch (e) {
        console.error('설정 로드 실패:', e);
    }
}

/**
 * 설정 저장
 */
function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (e) {
        console.error('설정 저장 실패:', e);
    }
}

// ============================================
// 2. 노드 관리 함수
// ============================================

/**
 * 고유한 노드 ID 생성
 */
function generateNodeId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 순환참조 여부 확인 (다중 부모 지원)
 * @returns true if targetId가 sourceId의 하위 노드면 (순환 위험)
 */
function isCircularReference(sourceId, targetId) {
    if (sourceId === targetId) return true;

    const visited = new Set();
    const queue = [targetId];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        if (visited.has(current)) continue;
        visited.add(current);

        if (current === sourceId) return true;

        const node = state.nodes.find((n) => n.id === current);
        if (node && node.parentIds) {
            node.parentIds.forEach((parentId) => queue.push(parentId));
        }
    }
    return false;
}

/**
 * 노드 추가
 */
function addNode(name, taxonomyLevel, parentIds = [], description = '', color = '#3498db') {
    // 부모들이 존재하는지 확인
    parentIds.forEach((parentId) => {
        if (!state.nodes.find((n) => n.id === parentId)) {
            alert(`부모 노드 "${parentId}"가 없습니다.`);
            throw new Error('Invalid parent');
        }
    });

    // 순환참조 확인
    for (const parentId of parentIds) {
        if (isCircularReference(parentId, null)) {
            alert('순환참조가 불가능합니다.');
            return;
        }
    }

    const nodeId = generateNodeId();
    const node = {
        id: nodeId,
        name,
        taxonomyLevel,
        description,
        color,
        parentIds: parentIds || [],
    };

    state.nodes.push(node);

    // 위치 초기화 (부모가 있으면 부모 근처, 없으면 랜덤)
    if (parentIds.length > 0) {
        const parentPos = state.nodePositions[parentIds[0]] || { x: CANVAS_WIDTH / 2, y: CANVAS_HEIGHT / 2 };
        state.nodePositions[nodeId] = {
            x: parentPos.x + (Math.random() - 0.5) * 150,
            y: parentPos.y + (Math.random() - 0.5) * 150,
        };
    } else {
        state.nodePositions[nodeId] = {
            x: Math.random() * CANVAS_WIDTH,
            y: Math.random() * CANVAS_HEIGHT,
        };
    }

    // 속도 초기화
    state.nodeVelocities[nodeId] = { vx: 0, vy: 0 };

    saveToLocalStorage();
    render();
    return nodeId;
}

/**
 * 노드 삭제 (하위 노드도 함께 삭제)
 */
function deleteNode(nodeId) {
    // 자식 노드들의 parentIds에서 해당 부모만 제거
    const children = state.nodes.filter((n) => n.parentIds && n.parentIds.includes(nodeId));
    children.forEach((child) => {
        // 다른 부모가 있으면 해당 부모만 제거
        if (child.parentIds.length > 1) {
            child.parentIds = child.parentIds.filter((id) => id !== nodeId);
        } else {
            // 유일한 부모면 자식도 삭제
            deleteNode(child.id);
            return;
        }
    });

    // 해당 노드 삭제
    state.nodes = state.nodes.filter((n) => n.id !== nodeId);
    delete state.nodePositions[nodeId];
    delete state.nodeVelocities[nodeId];

    if (state.selectedNodeId === nodeId) {
        state.selectedNodeId = null;
    }

    saveToLocalStorage();
    render();
}

/**
 * 노드 수정
 */
function updateNode(nodeId, name, taxonomyLevel, parentIds = [], description = '', color = '#3498db') {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    // 순환참조 확인
    for (const parentId of parentIds) {
        if (parentId !== nodeId && isCircularReference(nodeId, parentId)) {
            alert('순환참조가 불가능합니다.');
            return;
        }
    }

    node.name = name;
    node.taxonomyLevel = taxonomyLevel;
    node.parentIds = parentIds || [];
    node.description = description;
    node.color = color;

    saveToLocalStorage();
    render();
}

/**
 * 노드 위치 업데이트
 */
function updateNodePosition(nodeId, x, y) {
    if (!state.nodePositions[nodeId]) {
        state.nodePositions[nodeId] = { x, y };
    } else {
        state.nodePositions[nodeId].x = x;
        state.nodePositions[nodeId].y = y;
    }
    saveToLocalStorage();
}

/**
 * 노드 위치 업데이트 (물리 시뮬레이션)
 */
function applyVelocity() {
    state.nodes.forEach((node) => {
        const pos = state.nodePositions[node.id];
        const vel = state.nodeVelocities[node.id];

        if (!pos || !vel) return;

        // 위치 업데이트
        pos.x += vel.vx * 0.5; // 스텝 크기
        pos.y += vel.vy * 0.5;

        // 속도 감속 (마찰)
        vel.vx *= REPULSION_FRICTION;
        vel.vy *= REPULSION_FRICTION;
    });
}

/**
 * 스프링 장력 - 간선을 따라 당기는 힘
 */
function applySpringForces() {
    // springStrength가 0이면 비활성화
    if (state.settings.springStrength === 0) return;

    const targetDistance = state.settings.nodeSize * 3; // 목표 거리

    state.nodes.forEach((node) => {
        if (!node.parentIds || node.parentIds.length === 0) return;

        // 각 부모에 대해 스프링 포스 적용
        node.parentIds.forEach((parentId) => {
            const parent = state.nodes.find((n) => n.id === parentId);
            if (!parent) return;

            const posA = state.nodePositions[parentId];
            const posB = state.nodePositions[node.id];

            if (!posA || !posB) return;

            const dx = posB.x - posA.x;
            const dy = posB.y - posA.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 1) return; // 0 거리 방지

            // 스프링 포스: (현재거리 - 목표거리) * 강도
            const force = (distance - targetDistance) * state.settings.springStrength * 0.01;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;

            // 부모는 끌어당기고, 자식은 밀려남
            state.nodeVelocities[parentId].vx += fx * 0.5;
            state.nodeVelocities[parentId].vy += fy * 0.5;
            state.nodeVelocities[node.id].vx -= fx * 0.5;
            state.nodeVelocities[node.id].vy -= fy * 0.5;
        });
    });
}

/**
 * 반발력 물리엔진 - 노드 간 반발력 계산
 */
function applyRepulsionForces() {
    // 노드 간 반발력 계산 (속도 누적)
    for (let i = 0; i < state.nodes.length; i++) {
        for (let j = i + 1; j < state.nodes.length; j++) {
            const nodeA = state.nodes[i];
            const nodeB = state.nodes[j];

            const posA = state.nodePositions[nodeA.id];
            const posB = state.nodePositions[nodeB.id];

            if (!posA || !posB) continue;

            const dx = posB.x - posA.x;
            const dy = posB.y - posA.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // 최대 반발 범위 체크
            if (distance > state.settings.repulsionDistance) continue;
            if (distance < 1) continue; // 0 거리 방지

            // 근처 노드에만 반발력 적용
            const force = (state.settings.repulsionDistance - distance) / state.settings.repulsionDistance;
            const actualForce = force * state.settings.repulsionForce;

            const fx = (-dx / distance) * actualForce;
            const fy = (-dy / distance) * actualForce;

            state.nodeVelocities[nodeA.id].vx += fx;
            state.nodeVelocities[nodeA.id].vy += fy;
            state.nodeVelocities[nodeB.id].vx -= fx;
            state.nodeVelocities[nodeB.id].vy -= fy;
        }
    }
}

// ============================================
// 3. 분류 단계 관리
// ============================================

/**
 * 분류 단계 추가
 */
function addTaxonomyLevel(levelName) {
    if (state.taxonomyLevels.includes(levelName)) {
        alert('이미 존재하는 단계입니다.');
        return;
    }
    state.taxonomyLevels.push(levelName);
    saveToLocalStorage();
    updateTaxonomySelects();
}

/**
 * 드롭다운 및 선택지 업데이트
 */
function updateTaxonomySelects() {
    const levelSelect = document.getElementById('taxonomyLevel');
    const editLevelSelect = document.getElementById('editLevel');
    const currentValue = levelSelect.value;
    const currentEditValue = editLevelSelect.value;

    levelSelect.innerHTML = '<option value="">-- 단계 선택 --</option>';
    editLevelSelect.innerHTML = '';

    state.taxonomyLevels.forEach((level) => {
        const option1 = document.createElement('option');
        option1.value = level;
        option1.textContent = level;
        levelSelect.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = level;
        option2.textContent = level;
        editLevelSelect.appendChild(option2);
    });

    levelSelect.value = currentValue;
    editLevelSelect.value = currentEditValue;
}

/**
 * 부모 노드 선택 체크박스 생성 (추가 탭)
 */
/**
 * 부모 노드 선택 체크박스 생성 (필터링 지원)
 */
function updateParentCheckboxes() {
    const container = document.getElementById('nodeParentCheckboxes');
    const searchInput = document.getElementById('nodeParentSearchInput');
    const searchValue = (searchInput?.value || '').toLowerCase();

    container.innerHTML = '';

    // 검색어로 필터링된 노드만 표시
    const filteredNodes = state.nodes.filter((node) =>
        node.name.toLowerCase().includes(searchValue) ||
        node.taxonomyLevel.toLowerCase().includes(searchValue)
    );

    // 검색 결과 없음
    if (filteredNodes.length === 0 && searchValue) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.fontSize = '13px';
        emptyMsg.style.color = '#999';
        emptyMsg.style.padding = '8px';
        emptyMsg.textContent = '검색 결과 없음';
        container.appendChild(emptyMsg);
        return;
    }

    // 모든 노드 또는 필터링된 노드 표시
    filteredNodes.forEach((node) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.marginBottom = '6px';
        label.style.cursor = 'pointer';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = node.id;
        checkbox.className = 'parent-checkbox';
        checkbox.style.marginRight = '8px';
        checkbox.style.cursor = 'pointer';

        const text = document.createElement('span');
        text.textContent = `${node.name} (${node.taxonomyLevel})`;
        text.style.fontSize = '13px';

        label.appendChild(checkbox);
        label.appendChild(text);
        container.appendChild(label);
    });
}

/**
 * 편집 탭 부모 노드 선택 체크박스 생성 (필터링 지원)
 */
function updateEditParentCheckboxes(currentNodeId) {
    const container = document.getElementById('editParentCheckboxes');
    const searchInput = document.getElementById('editParentSearchInput');
    const searchValue = (searchInput?.value || '').toLowerCase();

    container.innerHTML = '';

    // 현재 노드 제외하고 검색어로 필터링된 노드만 표시
    const filteredNodes = state.nodes
        .filter((n) => n.id !== currentNodeId)
        .filter((node) =>
            node.name.toLowerCase().includes(searchValue) ||
            node.taxonomyLevel.toLowerCase().includes(searchValue)
        );

    // 검색 결과 없음
    if (filteredNodes.length === 0 && searchValue) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.fontSize = '13px';
        emptyMsg.style.color = '#999';
        emptyMsg.style.padding = '8px';
        emptyMsg.textContent = '검색 결과 없음';
        container.appendChild(emptyMsg);
        return;
    }

    // 모든 노드 또는 필터링된 노드 표시
    filteredNodes.forEach((node) => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.marginBottom = '6px';
        label.style.cursor = 'pointer';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = node.id;
        checkbox.className = 'edit-parent-checkbox';
        checkbox.style.marginRight = '8px';
        checkbox.style.cursor = 'pointer';

        const text = document.createElement('span');
        text.textContent = `${node.name} (${node.taxonomyLevel})`;
        text.style.fontSize = '13px';

        label.appendChild(checkbox);
        label.appendChild(text);
        container.appendChild(label);
    });
}

// ============================================
// 4. 렌더링 함수 (SVG 생성)
// ============================================

/**
 * 화면 렌더링 (SVG 그리기만 담당)
 */
function render() {
    const svg = document.getElementById('canvas');
    svg.innerHTML = '';

    // SVG 기본 속성 설정
    svg.setAttribute('viewBox', `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    // 화살표 마커 정의
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 10 3, 0 6');
    polygon.setAttribute('fill', '#bdc3c7');
    
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);

    // Transform 그룹 생성 (줌과 팬을 위함)
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'transform-group';
    g.setAttribute(
        'transform',
        `translate(${state.viewTransform.x}, ${state.viewTransform.y}) scale(${state.viewTransform.scale})`
    );

    svg.appendChild(g);

    // 연결선과 노드 그리기
    drawConnectionsToGroup(g);
    drawNodesToGroup(g);
    updateStats();
}

/**
 * 연결선을 그룹에 그리기 (다중 부모 지원)
 */
function drawConnectionsToGroup(g) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    state.nodes.forEach((node) => {
        if (!node.parentIds || node.parentIds.length === 0) return;

        // 각 부모에 대해 연결선 그리기
        node.parentIds.forEach((parentId) => {
            const parent = state.nodes.find((n) => n.id === parentId);
            if (!parent) return;

            const pos1 = state.nodePositions[parentId];
            const pos2 = state.nodePositions[node.id];
            if (!pos1 || !pos2) return;

            const dx = pos2.x - pos1.x;
            const dy = pos2.y - pos1.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < state.settings.nodeSize * 2) return;

            // 노드 표면에서 시작/끝나도록 계산
            const ratio1 = state.settings.nodeSize / distance;
            const ratio2 = 1 - state.settings.nodeSize / distance;
            const startX = pos1.x + dx * ratio1;
            const startY = pos1.y + dy * ratio1;
            const endX = pos2.x - dx * (1 - ratio2);
            const endY = pos2.y - dy * (1 - ratio2);

            // 직선 연결선
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', startX);
            line.setAttribute('y1', startY);
            line.setAttribute('x2', endX);
            line.setAttribute('y2', endY);
            line.setAttribute('class', 'connection-line');
            line.setAttribute('stroke-width', state.settings.linkWidth);
            
            // 화살표 마커 사용
            if (state.settings.showArrows) {
                line.setAttribute('marker-end', 'url(#arrowhead)');
            }

            group.appendChild(line);
        });
    });

    g.appendChild(group);
}

/**
 * 노드를 그룹에 그리기
 */
function drawNodesToGroup(g) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    state.nodes.forEach((node) => {
        const pos = state.nodePositions[node.id];
        if (!pos) return;

        // 원 (노드)
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pos.x);
        circle.setAttribute('cy', pos.y);
        circle.setAttribute('r', state.settings.nodeSize);
        circle.setAttribute('fill', node.color);
        circle.setAttribute('class', 'node-circle' + (state.selectedNodeId === node.id ? ' selected' : ''));
        circle.setAttribute('data-node-id', node.id);

        // 마우스 이벤트
        circle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            selectNode(node.id);
            onNodeMouseDown(e, node.id);
        });
        group.appendChild(circle);

        // 텍스트
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', pos.x);
        text.setAttribute('y', pos.y);
        text.setAttribute('class', 'node-text');
        text.setAttribute('font-size', Math.max(10, state.settings.nodeSize * 0.6));
        text.textContent = node.name.substring(0, 8);
        text.style.pointerEvents = 'none';
        group.appendChild(text);
    });

    g.appendChild(group);
}

/**
 * 자동 애니메이션 루프 (requestAnimationFrame 기반)
 * 물리 시뮬레이션과 렌더링 반복
 */
function animate() {
    // 1. 반발력 계산
    applyRepulsionForces();

    // 2. 스프링 장력 계산
    applySpringForces();

    // 3. 속도를 위치에 반영
    applyVelocity();

    // 4. 화면 렌더링
    render();

    // 다음 프레임 요청
    requestAnimationFrame(animate);
}

// ============================================
// 5. 사용자 상호작용
// ============================================

let draggingNodeId = null;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartTransformX = 0;
let panStartTransformY = 0;

/**
 * 클린 좌표 변환: 스크린 좌표 -> 캔버스 좌표
 */
function screenToCanvasCoords(clientX, clientY) {
    const svg = document.getElementById('canvas');
    const rect = svg.getBoundingClientRect();

    // SVG의 실제 표시 크기
    const svgWidth = rect.width;
    const svgHeight = rect.height;

    // 스크린좌표를 SVG 정규화 좌표로 변환 (0~1)
    const normX = (clientX - rect.left) / svgWidth;
    const normY = (clientY - rect.top) / svgHeight;

    // SVG viewBox 크기에 맞춰 변환
    const viewX = normX * CANVAS_WIDTH;
    const viewY = normY * CANVAS_HEIGHT;

    // Transform 적용 (역 변환)
    const canvasX = (viewX - state.viewTransform.x) / state.viewTransform.scale;
    const canvasY = (viewY - state.viewTransform.y) / state.viewTransform.scale;

    return { x: canvasX, y: canvasY };
}

/**
 * 노드 드래그 시작
 */
function onNodeMouseDown(e, nodeId) {
    if (isPanning) return; // 팬 중일 때는 무시

    draggingNodeId = nodeId;

    document.addEventListener('mousemove', onNodeMouseMove);
    document.addEventListener('mouseup', onNodeMouseUp);
}

/**
 * 노드 드래그 중
 */
function onNodeMouseMove(e) {
    if (!draggingNodeId) return;

    const coords = screenToCanvasCoords(e.clientX, e.clientY);
    updateNodePosition(draggingNodeId, coords.x, coords.y);
    render();
}

/**
 * 노드 드래그 끝
 */
function onNodeMouseUp() {
    draggingNodeId = null;
    document.removeEventListener('mousemove', onNodeMouseMove);
    document.removeEventListener('mouseup', onNodeMouseUp);
}

/**
 * 팬(드래그) 시작 - 우클릭
 */
function startPan(clientX, clientY) {
    isPanning = true;
    panStartX = clientX;
    panStartY = clientY;
    panStartTransformX = state.viewTransform.x;
    panStartTransformY = state.viewTransform.y;

    document.addEventListener('mousemove', onPanMouseMove);
    document.addEventListener('mouseup', onPanMouseUp);
    document.body.style.cursor = 'grabbing';
}

/**
 * 팬 중 마우스 이동
 */
function onPanMouseMove(e) {
    if (!isPanning) return;

    const deltaX = e.clientX - panStartX;
    const deltaY = e.clientY - panStartY;

    state.viewTransform.x = panStartTransformX + (deltaX / state.viewTransform.scale) * state.settings.panSensitivity;
    state.viewTransform.y = panStartTransformY + (deltaY / state.viewTransform.scale) * state.settings.panSensitivity;

    render();
}

/**
 * 팬 끝
 */
function onPanMouseUp() {
    isPanning = false;
    document.removeEventListener('mousemove', onPanMouseMove);
    document.removeEventListener('mouseup', onPanMouseUp);
    document.body.style.cursor = 'default';
}

/**
 * 줌 (마우스 휠)
 */
function onCanvasWheel(e) {
    e.preventDefault();

    const coords = screenToCanvasCoords(e.clientX, e.clientY);

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.viewTransform.scale * zoomFactor));

    // 줌 중심점이 화면에서 같은 위치에 있도록 transform 조정
    state.viewTransform.x = coords.x - (coords.x - state.viewTransform.x) * (newScale / state.viewTransform.scale);
    state.viewTransform.y = coords.y - (coords.y - state.viewTransform.y) * (newScale / state.viewTransform.scale);

    state.viewTransform.scale = newScale;

    render();
}

/**
 * 노드 선택 및 편집 탭 자동 이동
 */
function selectNode(nodeId) {
    state.selectedNodeId = nodeId;
    const node = state.nodes.find((n) => n.id === nodeId);

    if (!node) return;

    // 편집 폼 표시
    showEditForm(node);
    
    // 자동으로 편집 탭으로 전환
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
    document.querySelector('[data-tab="edit"]').classList.add('active');
    document.getElementById('edit-tab').classList.add('active');
    
    render();
}

/**
 * 편집 폼 표시
 */
function showEditForm(node) {
    const form = document.getElementById('editForm');
    document.getElementById('editId').value = node.id;
    document.getElementById('editName').value = node.name;
    document.getElementById('editLevel').value = node.taxonomyLevel;
    document.getElementById('editDesc').value = node.description;
    document.getElementById('editColor').value = node.color;

    // 부모 노드 검색창 초기화
    document.getElementById('editParentSearchInput').value = '';

    // 부모 노드 체크박스 업데이트 및 선택
    updateEditParentCheckboxes(node.id);
    
    if (node.parentIds && node.parentIds.length > 0) {
        document.querySelectorAll('.edit-parent-checkbox').forEach((checkbox) => {
            checkbox.checked = node.parentIds.includes(checkbox.value);
        });
    }

    form.style.display = 'block';
}

/**
 * 편집 폼 숨김
 */
function hideEditForm() {
    document.getElementById('editForm').style.display = 'none';
    document.getElementById('editParentSearchInput').value = '';
    state.selectedNodeId = null;
    render();
}

// ============================================
// 6. 검색 기능
// ============================================

/**
 * 검색 수행
 */
function performSearch(query) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '';

    if (!query.trim()) return;

    const results = state.nodes.filter((n) =>
        n.name.toLowerCase().includes(query.toLowerCase()) ||
        n.taxonomyLevel.toLowerCase().includes(query.toLowerCase())
    );

    if (results.length === 0) {
        resultsDiv.innerHTML = '<div style="padding: 8px; color: #999;">검색 결과 없음</div>';
        return;
    }

    results.forEach((node) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `<strong>${node.name}</strong><br><small style="color: #888;">${node.taxonomyLevel}</small>`;
        item.addEventListener('click', () => {
            selectNode(node.id);
            document.getElementById('searchInput').value = '';
            resultsDiv.innerHTML = '';

            // 탭 전환
            document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
            document.querySelector('[data-tab="edit"]').classList.add('active');
            document.getElementById('edit-tab').classList.add('active');
        });
        resultsDiv.appendChild(item);
    });
}

// ============================================
// 7. 이벤트 리스너
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // 초기 로드
    if (!loadFromLocalStorage()) {
        initSampleData();
    } else {
        render();
    }

    // 탭 버튼
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));

            btn.classList.add('active');
            const tabId = btn.dataset.tab + '-tab';
            document.getElementById(tabId).classList.add('active');
        });
    });

    // 노드 추가 폼
    document.getElementById('nodeForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('nodeName').value;
        const level = document.getElementById('taxonomyLevel').value;
        const desc = document.getElementById('nodeDesc').value;
        const color = document.getElementById('nodeColor').value;

        // 선택된 부모 노드들 수집
        const parentIds = Array.from(document.querySelectorAll('.parent-checkbox:checked'))
            .map((checkbox) => checkbox.value);

        if (!level) {
            alert('분류 단계를 선택하세요.');
            return;
        }

        try {
            addNode(name, level, parentIds, desc, color);
        } catch (e) {
            return;
        }

        // 폼 초기화
        document.getElementById('nodeName').value = '';
        document.getElementById('taxonomyLevel').value = '';
        document.getElementById('nodeDesc').value = '';
        document.getElementById('nodeColor').value = '#3498db';
        document.getElementById('nodeParentSearchInput').value = '';
        updateParentCheckboxes();
        document.querySelectorAll('.parent-checkbox').forEach((cb) => (cb.checked = false));

        updateParentCheckboxes();
    });

    // 분류 단계 추가 폼
    document.getElementById('levelForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const levelName = document.getElementById('levelName').value;
        if (!levelName.trim()) {
            alert('단계 이름을 입력하세요.');
            return;
        }
        addTaxonomyLevel(levelName);
        document.getElementById('levelName').value = '';
    });

    // 새 단계 추가 버튼
    document.getElementById('addLevelBtn').addEventListener('click', () => {
        const levelName = prompt('새 분류 단계 이름을 입력하세요:');
        if (levelName) {
            addTaxonomyLevel(levelName);
        }
    });

    // 부모 노드 검색 (추가 탭)
    document.getElementById('nodeParentSearchInput').addEventListener('input', () => {
        updateParentCheckboxes();
    });

    // 부모 노드 검색 (편집 탭)
    document.getElementById('editParentSearchInput').addEventListener('input', () => {
        const currentNodeId = document.getElementById('editId').value;
        updateEditParentCheckboxes(currentNodeId);
    });

    // 편집 폼 제출
    document.getElementById('editForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const nodeId = document.getElementById('editId').value;
        const name = document.getElementById('editName').value;
        const level = document.getElementById('editLevel').value;
        const desc = document.getElementById('editDesc').value;
        const color = document.getElementById('editColor').value;

        // 선택된 부모 노드들 수집
        const parentIds = Array.from(document.querySelectorAll('.edit-parent-checkbox:checked'))
            .map((checkbox) => checkbox.value);

        updateNode(nodeId, name, level, parentIds, desc, color);
        hideEditForm();
        updateParentCheckboxes();
    });

    // 노드 삭제 버튼
    document.getElementById('deleteNodeBtn').addEventListener('click', () => {
        const nodeId = document.getElementById('editId').value;
        if (confirm('이 노드를 삭제하시겠습니까? (하위 노드도 함께 삭제됩니다)')) {
            deleteNode(nodeId);
            hideEditForm();
            updateParentCheckboxes();
        }
    });

    // 취소 버튼
    document.getElementById('cancelEditBtn').addEventListener('click', () => {
        hideEditForm();
    });

    // 검색 입력
    document.getElementById('searchInput').addEventListener('input', (e) => {
        performSearch(e.target.value);
    });

    // JSON 내보내기
    document.getElementById('exportBtn').addEventListener('click', () => {
        const data = {
            nodes: state.nodes,
            taxonomyLevels: state.taxonomyLevels,
            exportedAt: new Date().toISOString(),
        };
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taxonomy_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // JSON 불러오기
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.nodes && Array.isArray(data.nodes) && data.taxonomyLevels && Array.isArray(data.taxonomyLevels)) {
                    state.nodes = data.nodes;
                    state.taxonomyLevels = data.taxonomyLevels;

                    // 이전 단일 parentId를 parentIds 배열로 변환 (하위호환성)
                    state.nodes.forEach((node) => {
                        if (node.parentId && !node.parentIds) {
                            node.parentIds = [node.parentId];
                            delete node.parentId;
                        } else if (!node.parentIds) {
                            node.parentIds = [];
                        }
                    });

                    // 위치 정보가 없으면 초기화
                    state.nodePositions = {};
                    state.nodeVelocities = {};
                    state.nodes.forEach((node, index) => {
                        if (!data.nodePositions || !data.nodePositions[node.id]) {
                            state.nodePositions[node.id] = {
                                x: (index % 10) * 150 + 100,
                                y: Math.floor(index / 10) * 150 + 100,
                            };
                        } else {
                            state.nodePositions[node.id] = data.nodePositions[node.id];
                        }
                        state.nodeVelocities[node.id] = { vx: 0, vy: 0 };
                    });

                    saveToLocalStorage();
                    updateTaxonomySelects();
                    updateParentCheckboxes();
                    render();
                    alert('데이터 불러오기 완료!');
                } else {
                    alert('올바른 형식의 JSON 파일이 아닙니다.');
                }
            } catch (error) {
                alert('파일 읽기 오류: ' + error.message);
            }
        };
        reader.readAsText(file);

        // 파일 입력 초기화
        e.target.value = '';
    });

    // 초기화 버튼
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (confirm('샘플 데이터로 초기화하시겠습니까?')) {
            state.nodes = [];
            state.taxonomyLevels = [];
            state.nodePositions = {};
            state.selectedNodeId = null;
            initSampleData();
            updateTaxonomySelects();
            updateParentCheckboxes();
            hideEditForm();
        }
    });

    // 모든 데이터 삭제
    document.getElementById('clearBtn').addEventListener('click', () => {
        if (confirm('모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
            state.nodes = [];
            state.taxonomyLevels = [];
            state.nodePositions = {};
            state.selectedNodeId = null;
            saveToLocalStorage();
            updateTaxonomySelects();
            updateParentCheckboxes();
            hideEditForm();
            render();
        }
    });

    // 캔버스 클릭
    document.getElementById('canvas').addEventListener('click', (e) => {
        if (e.target.id === 'canvas') {
            hideEditForm();
        }
    });

    // 캔버스 마우스휠 (줌)
    document.getElementById('canvas').addEventListener('wheel', onCanvasWheel, { passive: false });

    // 캔버스 우클릭 팬 (드래그)
    document.getElementById('canvas').addEventListener('mousedown', (e) => {
        if (e.button === 2) { // 우클릭
            e.preventDefault();
            startPan(e.clientX, e.clientY);
        }
    });

    // 우클릭 메뉴 방지
    document.getElementById('canvas').addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // ===== 설정 슬라이더 이벤트 리스너 =====
    
    // 반발력 슬라이더
    document.getElementById('repulsionForceSlider').addEventListener('input', (e) => {
        state.settings.repulsionForce = parseFloat(e.target.value);
        document.getElementById('repulsionForceValue').textContent = state.settings.repulsionForce.toFixed(1);
        saveSettings();
    });

    // 반발 범위 슬라이더
    document.getElementById('repulsionDistanceSlider').addEventListener('input', (e) => {
        state.settings.repulsionDistance = parseFloat(e.target.value);
        document.getElementById('repulsionDistanceValue').textContent = state.settings.repulsionDistance;
        saveSettings();
    });

    // 노드 크기 슬라이더
    document.getElementById('nodeSizeSlider').addEventListener('input', (e) => {
        state.settings.nodeSize = parseFloat(e.target.value);
        document.getElementById('nodeSizeValue').textContent = state.settings.nodeSize;
        saveSettings();
    });

    // 연결선 두께 슬라이더
    document.getElementById('linkWidthSlider').addEventListener('input', (e) => {
        state.settings.linkWidth = parseFloat(e.target.value);
        document.getElementById('linkWidthValue').textContent = state.settings.linkWidth.toFixed(1);
        saveSettings();
    });

    // 화살표 표시 토글
    document.getElementById('showArrowsCheckbox').addEventListener('change', (e) => {
        state.settings.showArrows = e.target.checked;
        saveSettings();
    });

    // 간선 장력 슬라이더
    document.getElementById('springStrengthSlider').addEventListener('input', (e) => {
        state.settings.springStrength = parseFloat(e.target.value);
        document.getElementById('springStrengthValue').textContent = state.settings.springStrength.toFixed(1);
        saveSettings();
    });

    // 팬 감도 슬라이더
    document.getElementById('panSensitivitySlider').addEventListener('input', (e) => {
        state.settings.panSensitivity = parseFloat(e.target.value);
        document.getElementById('panSensitivityValue').textContent = state.settings.panSensitivity.toFixed(1);
        saveSettings();
    });

    // 초기 설정 로드
    loadSettings();
    document.getElementById('repulsionForceSlider').value = state.settings.repulsionForce;
    document.getElementById('repulsionForceValue').textContent = state.settings.repulsionForce.toFixed(1);
    document.getElementById('repulsionDistanceSlider').value = state.settings.repulsionDistance;
    document.getElementById('repulsionDistanceValue').textContent = state.settings.repulsionDistance;
    document.getElementById('nodeSizeSlider').value = state.settings.nodeSize;
    document.getElementById('nodeSizeValue').textContent = state.settings.nodeSize;
    document.getElementById('linkWidthSlider').value = state.settings.linkWidth;
    document.getElementById('linkWidthValue').textContent = state.settings.linkWidth.toFixed(1);
    document.getElementById('showArrowsCheckbox').checked = state.settings.showArrows;
    document.getElementById('springStrengthSlider').value = state.settings.springStrength;
    document.getElementById('springStrengthValue').textContent = state.settings.springStrength.toFixed(1);
    document.getElementById('panSensitivitySlider').value = state.settings.panSensitivity;
    document.getElementById('panSensitivityValue').textContent = state.settings.panSensitivity.toFixed(1);

    // 초기 업데이트
    updateTaxonomySelects();
    updateParentCheckboxes();
    
    // 초기 렌더링 및 자동 애니메이션 시작
    render();
    animate();
});

// ============================================
// 8. 통계 업데이트
// ============================================

/**
 * 통계 정보 업데이트
 */
function updateStats() {
    document.getElementById('statNodes').textContent = state.nodes.length;
    document.getElementById('statLevels').textContent = state.taxonomyLevels.length;
}
