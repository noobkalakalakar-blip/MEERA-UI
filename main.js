import {
    FilesetResolver,
    FaceLandmarker,
    HandLandmarker
} from "@mediapipe/tasks-vision";


// ============================================
// DOM
// ============================================

const video = document.getElementById("webcam");

const overlay = document.getElementById("overlay");

const ctx = overlay.getContext("2d");

const handCursor =
    document.getElementById("hand-cursor");

const systemStatus =
    document.getElementById("system-status");

const faceStatus =
    document.getElementById("face-status");

const faceProgress =
    document.getElementById("face-progress");

const faceDetection =
    document.getElementById("face-detection");

const debugFace =
    document.getElementById("debug-face");

const debugHand =
    document.getElementById("debug-hand");

document.body.classList.add("opening-context");


// ============================================
// MEDIAPIPE
// ============================================

let faceLandmarker;
let handLandmarker;

let modelsReady = false;

let lastVideoTime = -1;
let lastFaceLandmarks = null;
let detectionBusy = false;


// ============================================
// EXPERIENCE STATE
// ============================================

let currentScreen = "intro";
let screenHistory = [];

let faceScanning = false;

let faceScanProgress = 0;

let handControl = true;

let doseStage = "idle";
let dosePinchStart = 0;
let doseEatStart = 0;
let doseTaken = false;


// ============================================
// HAND STATE
// ============================================

let handX = 0.5;

let handY = 0.5;

let isPinching = false;

let previousPinch = false;

// Pinch-scroll is intentionally limited to the medicine/chemical page.
let chemicalScrollActive = false;
let chemicalScrollLastY = null;
let chemicalScrollLastTime = 0;
let dispenseLocked = false;
let continueHandPinchStart = 0;
let handActivationLockUntil = 0;
let requirePinchRelease = false;
let pinchClickStart = 0;
let pinchLatched = false;
let activatedPinchElement = null;
let dispenseAllowed = false;
let phoneCompletionPoll = null;

let hoveredElement = null;

let hoverStartTime = 0;


// ============================================
// CAMERA
// ============================================

async function startCamera() {

    try {

        const stream =
            await navigator.mediaDevices.getUserMedia({

                video: {
                    facingMode: "user",
                    width: {
                        ideal: 640,
                        max: 640
                    },
                    height: {
                        ideal: 480,
                        max: 480
                    },
                    frameRate: {
                        ideal: 30,
                        max: 30
                    }
                },

                audio: false

            });

        video.srcObject = stream;

        await video.play();

        resizeCanvas();

        window.addEventListener(
            "resize",
            resizeCanvas
        );

        console.log("Camera started");

    } catch (error) {

        console.error(
            "Camera error:",
            error
        );

        alert(
            "Camera access is required. Please allow camera permissions and reload."
        );

    }

}


// ============================================
// CANVAS
// ============================================

function resizeCanvas() {

    overlay.width =
        video.videoWidth ||
        window.innerWidth;

    overlay.height =
        video.videoHeight ||
        window.innerHeight;

}


// ============================================
// LOAD MEDIAPIPE
// ============================================

async function initializeMediaPipe() {

    systemStatus.textContent =
        "LOADING VISION SYSTEM";

    const vision =
        await FilesetResolver.forVisionTasks(

            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"

        );


    // ========================================
    // FACE
    // ========================================

    faceLandmarker =
        await FaceLandmarker.createFromOptions(

            vision,

            {

                baseOptions: {

                    modelAssetPath:
                        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

                },

                runningMode: "VIDEO",

                numFaces: 1,

                minFaceDetectionConfidence: 0.5,

                minFacePresenceConfidence: 0.5,

                minTrackingConfidence: 0.5

            }

        );


    // ========================================
    // HAND
    // ========================================

    handLandmarker =
        await HandLandmarker.createFromOptions(

            vision,

            {

                baseOptions: {

                    modelAssetPath:
                        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

                },

                runningMode: "VIDEO",

                numHands: 1,

                minHandDetectionConfidence: 0.35,

                minHandPresenceConfidence: 0.35,

                minTrackingConfidence: 0.35

            }

        );


    modelsReady = true;

    handControl = true;

    systemStatus.textContent =
        "VISION + HAND READY";

    console.log(
        "Face + Hand models ready"
    );

}


// ============================================
// SCREEN SYSTEM
// ============================================

function showScreen(id, options = {}) {

    const { pushHistory = true } = options;

    if (!id || id === currentScreen) return;

    if (pushHistory && currentScreen) {
        screenHistory.push(currentScreen);
    }

    document
        .querySelectorAll(".screen")
        .forEach(screen => screen.classList.remove("active"));

    const screen = document.getElementById(id);

    if (screen) {
        screen.classList.add("active");
        currentScreen = id;
    }

    document.body.classList.toggle(
        "opening-context",
        id === "intro" || id === "parkinson-screen"
    );

    // Never carry a pinch-scroll gesture from one screen to another.
    chemicalScrollActive = false;
    chemicalScrollLastY = null;
    document.body.classList.remove("chemical-scroll-active");

}

function goBack() {
    const previous = screenHistory.pop();
    if (previous) {
        showScreen(previous, { pushHistory: false });
    }
}


// ============================================
// OPENING FLOW
// ============================================

function startOpeningFlow() {
    showScreen("parkinson-screen");
    systemStatus.textContent = "MEERA / PARKINSON'S";
}

document.getElementById("parkinson-next-btn").addEventListener("click", () => {
    showScreen("face-screen");
    faceScanning = true;
    faceScanProgress = 0;
    faceProgress.style.width = "0%";
    systemStatus.textContent = "IDENTITY SCAN ACTIVE";
});

// Hold the opening state for 3 seconds, then reveal the condition screen.
setTimeout(startOpeningFlow, 3000);

// ============================================
// FACE SCAN
// ============================================

function processFace(result) {

    const faces =
        result.faceLandmarks;

    if (
        !faces ||
        faces.length === 0
    ) {

        faceStatus.textContent =
            "FACE NOT DETECTED";

        faceDetection.textContent =
            "SEARCHING";

        debugFace.textContent =
            "NO";

        lastFaceLandmarks = null;
        return;

    }


    debugFace.textContent =
        "YES";

    lastFaceLandmarks = faces[0];
    const face = faces[0];
    const faceBox = getFaceBox(face);
    const frame = document.querySelector(".face-frame");
    const frameRect = frame ? frame.getBoundingClientRect() : null;
    const faceInside = frameRect ? isFaceInsideZone(faceBox, frameRect) : false;

    faceDetection.textContent = faceInside ? "IN ZONE" : "MOVE INTO ZONE";

    if (!faceScanning) {
        drawFaceMesh(face);
        return;
    }

    drawFaceMesh(face);

    if (!faceInside) {
        faceStatus.textContent = "MOVE INTO THE SCAN ZONE";
        faceProgress.style.width = "0%";
        faceScanProgress = 0;
        return;
    }

    faceStatus.textContent =
        "FACE DETECTED — HOLD STILL";

    faceScanProgress += 0.9;

    if (faceScanProgress > 100) {

        faceScanProgress = 100;

    }

    faceProgress.style.width =
        `${faceScanProgress}%`;


    drawFaceMesh(
        faces[0]
    );


    if (faceScanProgress >= 100) {

        finishFaceScan();

    }

}


// ============================================
// FACE ZONE HELPERS
// ============================================

function getFaceBox(landmarks) {
    const xs = landmarks.map(p => p.x);
    const ys = landmarks.map(p => p.y);
    return {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
        centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
        centerY: (Math.min(...ys) + Math.max(...ys)) / 2
    };
}

function isFaceInsideZone(box, rect) {
    // Camera is mirrored for the user, but the normalized face coordinates
    // are mirrored by the hand/camera presentation in the same way.
    const cx = (1 - box.centerX) * window.innerWidth;
    const cy = box.centerY * window.innerHeight;
    const w = (box.maxX - box.minX) * window.innerWidth;
    const h = (box.maxY - box.minY) * window.innerHeight;
    const zonePadX = rect.width * 0.06;
    const zonePadY = rect.height * 0.04;
    return cx > rect.left + zonePadX &&
           cx < rect.right - zonePadX &&
           cy > rect.top + zonePadY &&
           cy < rect.bottom - zonePadY &&
           w > rect.width * 0.18 &&
           w < rect.width * 0.90 &&
           h > rect.height * 0.20 &&
           h < rect.height * 0.98;
}

function getFaceMouthPoint(landmarks) {
    // Face-landmark points around the lips. Average several stable landmarks.
    const ids = [13, 14, 78, 308];
    const pts = ids.map(i => landmarks[i]).filter(Boolean);
    if (!pts.length) return null;
    return {
        x: 1 - pts.reduce((sum,p) => sum + p.x, 0) / pts.length,
        y: pts.reduce((sum,p) => sum + p.y, 0) / pts.length
    };
}

function distancePx(a,b) {
    return Math.hypot(a.x-b.x, a.y-b.y);
}

function resetDoseState() {
    doseStage = "idle";
    dosePinchStart = 0;
    doseEatStart = 0;
    doseTaken = false;

    const status = document.getElementById("dose-status");
    const instruction = document.getElementById("dose-instruction");
    const detection = document.getElementById("dose-detection");

    if (status) status.textContent = "";
    if (instruction) instruction.textContent = "EAT YOUR DOSE TO UPDATE YOUR INSURANCE";
    if (detection) detection.textContent = "";
}

function setDoseStage(stage) {
    doseStage = stage;
    const status = document.getElementById("dose-status");
    const instruction = document.getElementById("dose-instruction");
    const detection = document.getElementById("dose-detection");

    if (stage === "eat") {
        if (status) status.textContent = "";
        if (instruction) instruction.textContent = "EAT YOUR DOSE TO UPDATE YOUR INSURANCE";
        if (detection) detection.textContent = "";
    }
}

// ============================================
// FACE MESH
// ============================================

function drawFaceMesh(landmarks) {

    if (
        !landmarks ||
        landmarks.length === 0
    ) return;


    ctx.save();


    ctx.clearRect(
        0,
        0,
        overlay.width,
        overlay.height
    );


    ctx.fillStyle =
        "rgba(220,255,250,0.7)";


    for (
        let i = 0;
        i < landmarks.length;
        i += 8
    ) {

        const point =
            landmarks[i];


        const x =
            point.x *
            overlay.width;


        const y =
            point.y *
            overlay.height;


        ctx.beginPath();

        ctx.arc(
            x,
            y,
            1.2,
            0,
            Math.PI * 2
        );

        ctx.fill();

    }


    ctx.restore();

}


// ============================================
// FACE COMPLETE
// ============================================

function finishFaceScan() {

    faceScanning = false;

    systemStatus.textContent =
        "IDENTITY CREATED";

    faceStatus.textContent =
        "IDENTITY CONFIRMED";


    setTimeout(
        () => {

            showScreen(
                "identity-screen"
            );

        },
        650
    );

}


// ============================================
// ACTIVATE HAND CONTROL
// ============================================

document
    .getElementById("continue-hand")
    .addEventListener(
        "click",
        () => {

            handControl = true;

            systemStatus.textContent =
                "HAND CONTROL ACTIVE";

            handActivationLockUntil = performance.now() + 650;
            requirePinchRelease = true;
            pinchLatched = true;
            showScreen(
                "home-screen"
            );

        }
    );


// ============================================
// HAND PROCESSING
// ============================================

function processHands(result) {

    const hands =
        result.landmarks;


    if (
        !hands ||
        hands.length === 0
    ) {

        handCursor.style.display =
            "none";

        debugHand.textContent =
            "NO";

        return;

    }


    debugHand.textContent =
        "YES";


    const hand =
        hands[0];


    const index =
        hand[8];


    const thumb =
        hand[4];


    // ========================================
    // INDEX FINGER POSITION
    // ========================================

    handX =
        1 - index.x;

    handY =
        index.y;


    const screenX =
        handX *
        window.innerWidth;


    const screenY =
        handY *
        window.innerHeight;


    handCursor.style.display =
        "block";


    handCursor.style.left =
        `${screenX}px`;


    handCursor.style.top =
        `${screenY}px`;


    // ========================================
    // PINCH
    // ========================================

    const distance =
        Math.sqrt(
            Math.pow(index.x - thumb.x, 2) +
            Math.pow(index.y - thumb.y, 2)
        );

    // Normalize pinch distance to hand size so an external webcam
    // being farther away does not make pinching harder to detect.
    const wrist = hand[0];
    const middleMcp = hand[9];
    const handScale = Math.max(
        Math.sqrt(
            Math.pow(wrist.x - middleMcp.x, 2) +
            Math.pow(wrist.y - middleMcp.y, 2)
        ),
        0.045
    );

    const pinchRatio = distance / handScale;

    isPinching = previousPinch
        ? pinchRatio < 0.95
        : pinchRatio < 0.82;


    if (isPinching) {

        handCursor.classList.add(
            "pinch"
        );

    } else {

        handCursor.classList.remove(
            "pinch"
        );

    }


    // ========================================
    // DOSE INTERACTION
    // ========================================

    if (currentScreen === "dose-screen" && doseStage !== "idle") {
        processDoseGesture(screenX, screenY);
    }

    // ========================================
    // INTERACTION
    // ========================================

    updateHandInteraction(
        screenX,
        screenY
    );

    updateChemicalPinchScroll(screenX, screenY);


    previousPinch =
        isPinching;

}


function processDoseGesture(screenX, screenY) {
    if (doseStage !== "eat" || doseTaken) return;

    const faces = lastFaceLandmarks;
    if (!faces) return;

    const mouth = getFaceMouthPoint(faces);
    if (!mouth) return;

    const mouthPx = {
        x: mouth.x * window.innerWidth,
        y: mouth.y * window.innerHeight
    };

    const distance = distancePx(
        { x: screenX, y: screenY },
        mouthPx
    );

    const nearFace =
        distance < Math.min(window.innerWidth, window.innerHeight) * 0.18;

    if (isPinching && nearFace) {
        if (!doseEatStart) doseEatStart = performance.now();

        if (performance.now() - doseEatStart > 650) {
            doseTaken = true;
            doseStage = "done";

            const instruction = document.getElementById("dose-instruction");
            if (instruction) instruction.textContent = "YOU ARE COVERED";

            systemStatus.textContent = "DOSE TAKEN // YOU ARE COVERED";
            setTimeout(() => showScreen("complete-screen"), 900);
        }
    } else {
        doseEatStart = 0;
    }
}

// ============================================
// COMMON BUTTON CLICKS
// ============================================
// Every interactive button uses the same DOM click path. This keeps mouse
// clicks and hand-pinch clicks consistent instead of making some buttons
// depend on a separate activation path.
document.querySelectorAll(
    ".menu-option, .system-button, .back-button, .restart-button"
).forEach(button => {
    if (button.id === "parkinson-next-btn") return;
    button.addEventListener("click", () => activateElement(button));
});

// ============================================
// HAND INTERACTION
// ============================================

function updateHandInteraction(
    x,
    y
) {

    const elements =
        document.querySelectorAll(

            ".menu-option, " +
            ".system-button, " +
            ".back-button, " +
            ".restart-button"

        );


    let found = null;


    elements.forEach(element => {

        if (
            !element.offsetParent
        ) return;


        const rect =
            element.getBoundingClientRect();


        // Give the hand cursor a forgiving hit area. The external webcam
        // can introduce a few pixels of tracking error, so do not require
        // the fingertip to land exactly inside the visible button.
        const HIT_PAD = 55;

        if (
            x >= rect.left - HIT_PAD &&
            x <= rect.right + HIT_PAD &&
            y >= rect.top - HIT_PAD &&
            y <= rect.bottom + HIT_PAD

        ) {

            found = element;

        }

    });


    // ========================================
    // NOTHING HOVERED
    // ========================================

    if (!found) {

        if (hoveredElement) {

            hoveredElement
                .classList
                .remove("hovered");

        }

        hoveredElement = null;

        hoverStartTime = 0;

        return;

    }


    // ========================================
    // NEW ELEMENT
    // ========================================

    if (
        found !== hoveredElement
    ) {

        if (hoveredElement) {

            hoveredElement
                .classList
                .remove("hovered");

        }


        hoveredElement = found;

        hoveredElement
            .classList
            .add("hovered");

        hoverStartTime =
            performance.now();

    }


    // ========================================
    // PINCH — forgiving hysteresis + deliberate click
    // ========================================
    // Use a slightly larger detection window so projection distance and
    // lighting do not make the user repeat the gesture. A hysteresis band
    // prevents flickering between pinch/release while holding the gesture.
    if (requirePinchRelease) {
        if (!isPinching) {
            requirePinchRelease = false;
            activatedPinchElement = null;
            pinchClickStart = 0;
            pinchLatched = false;
            continueHandPinchStart = 0;
            handActivationLockUntil = performance.now() + 250;
        }
        return;
    }

    if (performance.now() < handActivationLockUntil) return;

    if (hoveredElement && isPinching) {
        if (!pinchClickStart) pinchClickStart = performance.now();

        // Fast, single pinch activation. The old 280ms hold made the
        // controls feel noticeably slower than the first button.
        if (!pinchLatched && performance.now() - pinchClickStart >= 90) {
            pinchLatched = true;
            activatedPinchElement = hoveredElement;
            // Use the normal DOM click path so every button behaves exactly
            // like a regular click, instead of having a separate hand-only
            // activation path.
            hoveredElement.click();
        }
    } else {
        pinchClickStart = 0;
        if (!isPinching) {
            pinchLatched = false;
            activatedPinchElement = null;
        }
    }
}


// ============================================
// CHEMICAL / MEDICINE PAGE PINCH SCROLL
// ============================================
// Scrolling is intentionally NOT enabled globally. It only works on
// medicine-screen, which is the page that already has a real scrollable
// medicine/chemical panel.
function updateChemicalPinchScroll(screenX, screenY) {
    if (currentScreen !== "medicine-screen") {
        chemicalScrollActive = false;
        chemicalScrollLastY = null;
        document.body.classList.remove("chemical-scroll-active");
        return;
    }

    const panel = document.querySelector(".medicine-panel");
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    const scrollbarZone = 42;
    const nearScrollbar =
        screenX >= rect.right - scrollbarZone &&
        screenX <= rect.right + 6 &&
        screenY >= rect.top &&
        screenY <= rect.bottom;

    if (!isPinching || !nearScrollbar) {
        chemicalScrollActive = false;
        chemicalScrollLastY = null;
        document.body.classList.remove("chemical-scroll-active");
        return;
    }

    if (!chemicalScrollActive) {
        chemicalScrollActive = true;
        chemicalScrollLastY = screenY;
        chemicalScrollLastTime = performance.now();
        document.body.classList.add("chemical-scroll-active");
        return;
    }

    const movement = screenY - chemicalScrollLastY;
    const now = performance.now();
    chemicalScrollLastTime = now;

    if (Math.abs(movement) < 2) return;

    const amount = Math.max(-18, Math.min(18, movement * 1.35));
    panel.scrollTop += amount;
    chemicalScrollLastY = screenY;
}


// ============================================
// ACTIVATE BUTTON
// ============================================

function activateElement(
    element
) {

    if (!element) return;

    if (element.classList.contains("back-button")) {
    const target = element.dataset.target;

    if (target) {
        showScreen(target);
    } else {
        goBack();
    }

    return;
    }   

    const target =
        element.dataset.target;


    if (target) {

        showScreen(
            target
        );

    }


    // PARKINSON'S CONTEXT → FACE SCAN
    if (element.id === "parkinson-next-btn") {
        showScreen("face-screen");
        faceScanning = true;
        faceScanProgress = 0;
        faceProgress.style.width = "0%";
        systemStatus.textContent = "IDENTITY SCAN ACTIVE";
        return;
    }

    // BEGIN

    if (element.id === "begin-btn") {

        showScreen("face-screen");

        faceScanning = true;

        faceScanProgress = 0;

        faceProgress.style.width = "0%";

        systemStatus.textContent =
            "IDENTITY SCAN ACTIVE";

    }


    // ACTIVATE HAND CONTROL / CONTINUE

    if (element.id === "continue-hand") {

        handControl = true;
        // Prevent the pinch used to activate hand control from carrying over
        // and clicking the first button on the home screen.
        handActivationLockUntil = performance.now() + 900;
        requirePinchRelease = true;

        systemStatus.textContent =
            "HAND CONTROL ACTIVE";

        showScreen("home-screen");

    }


    // BODY SCAN

    if (
        element.id ===
        "body-scan-btn"
    ) {

        startBodyScan();

    }


    // DISPENSE MEDICINE — only after the phone video has completed.
    if (element.id === "finish-btn") {
        const button = element;

        if (!dispenseAllowed || dispenseLocked) return;

        dispenseLocked = true;
        button.disabled = true;
        button.classList.add("dispense-locked");
        button.textContent = "DOSE DISPENSING…";

        // The video must remain visible on the phone. It is only stopped
        // when the whole experience is restarted.
        systemStatus.textContent = "DISPENSING DOSE";

        // Trigger the final spoken cue on the phone immediately when
        // DISPENSE DOSE is pressed. This is independent of the medicine.
        sendPhoneCommand("dispense-audio");

        fetch("/api/dispense", { method: "POST", cache: "no-store" })
            .then(response => {
                if (!response.ok) throw new Error(`ESP32 HTTP ${response.status}`);
                return response.text();
            })
            .then(data => {
                console.log("ESP32:", data);
                resetDoseState();
                showScreen("dose-screen");
                setDoseStage("eat");
                systemStatus.textContent = "DOSE DISPENSED // TAKE YOUR DOSE";
            })
            .catch(error => {
                console.error("Dispenser error:", error);
                dispenseLocked = false;
                button.disabled = false;
                button.classList.remove("dispense-locked");
                button.textContent = "DISPENSE DOSE";
                systemStatus.textContent = "DISPENSER CONNECTION ERROR — TRY AGAIN";
            });
    }

    if (element.id === "restart-btn") {
        stopPhoneVideo();
        window.location.reload();
        return;
    }

}


// ============================================
// DEMO CARE SETS
// ============================================
// These are UI demonstration profiles, not clinical decision rules.
// The dose field intentionally avoids numeric prescribing instructions.
const careSets = [
    {
        id: "A",
        medicine: "Paracetamol",
        video: "/medicine-videos/paracetamol.mp4",
        purpose: "Pain / fever symptom support",
        icon: "A1",
        reported: ["Joint pain", "Mild fever"],
        considered: ["Pain present", "Temperature symptoms", "No emergency warning shown"],
        supporting: ["Pain", "Fever"],
        doseMessage: "Profile A selected — clinician-confirmed dose required before dispensing.",
        chemical: {
            name: "Paracetamol (acetaminophen)",
            ingredient: "Paracetamol",
            formula: "C₈H₉NO₂",
            weight: "151.16 g/mol",
            cas: "103-90-2",
            cid: 1983
        }
    },
    {
        id: "B",
        medicine: "Amlodipine",
        video: "/medicine-videos/amlodipine.mp4",
        purpose: "Blood pressure management example",
        icon: "B2",
        reported: ["Elevated blood pressure", "Headache"],
        considered: ["Blood pressure pattern", "Reported symptoms", "No emergency warning shown"],
        supporting: ["Blood pressure", "Headache"],
        doseMessage: "Profile B selected — clinician-confirmed dose required before dispensing.",
        chemical: {
            name: "Amlodipine",
            ingredient: "Amlodipine",
            formula: "C₂₀H₂₅ClN₂O₅",
            weight: "408.88 g/mol",
            cas: "88150-42-9",
            cid: 2162
        }
    },
    {
        id: "C",
        medicine: "Atorvastatin",
        video: "/medicine-videos/atorvastatin.mp4",
        purpose: "Cholesterol management example",
        icon: "C3",
        reported: ["Routine lipid monitoring", "Preventive care"],
        considered: ["Cholesterol record", "Preventive pattern", "No emergency warning shown"],
        supporting: ["Lipid management", "Prevention"],
        doseMessage: "Profile C selected — clinician-confirmed dose required before dispensing.",
        chemical: {
            name: "Atorvastatin",
            ingredient: "Atorvastatin",
            formula: "C₃₃H₃₅FN₂O₅",
            weight: "558.64 g/mol",
            cas: "134523-00-5",
            cid: 60823
        }
    }
];

let activeCareSet = careSets[0];

function renderList(targetId, items) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = items.map(item => `<div class="symptom-item"><span>✓</span><strong>${item}</strong></div>`).join("");
}

function renderCareSet(set) {
    activeCareSet = set;

    document.getElementById("medicine-icon").textContent = set.icon;
    document.getElementById("medicine-name").textContent = set.medicine;
    document.getElementById("medicine-purpose").textContent = set.purpose;
    document.getElementById("dose-profile").textContent = `PROFILE ${set.id}`;
    document.getElementById("dispensing-message").textContent = set.doseMessage;

    renderList("reported-symptoms", set.reported);
    renderList("considered-symptoms", set.considered);
    renderList("supporting-symptoms", set.supporting);

    const c = set.chemical;
    document.getElementById("chemical-name").textContent = c.name;
    document.getElementById("active-ingredient").textContent = c.ingredient;
    document.getElementById("molecular-formula").textContent = c.formula;
    document.getElementById("molecular-weight").textContent = c.weight;
    document.getElementById("cas-number").textContent = c.cas;

    const img = document.getElementById("molecule-image");
    const fallback = document.getElementById("molecule-fallback");
    img.src = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${c.cid}/PNG`;
    img.onload = () => { fallback.style.display = "none"; };
    img.onerror = () => { fallback.style.display = "flex"; };
}

// ============================================
// PHONE VIDEO CONTROL
// ============================================
// The Android phone opens /phone.html from the same Vite server.
// Body Scan sends START; DISPENSE DOSE sends STOP/BLACK.
async function sendPhoneCommand(command, videoPath = null) {
    try {
        const suffix = command === "start" && videoPath
            ? "?video=" + encodeURIComponent(videoPath)
            : "";
        await fetch("/api/phone/" + command + suffix, {
            method: "POST",
            cache: "no-store"
        });
        console.log("Phone command:", command);
    } catch (error) {
        // Phone being offline must never break the laptop UI.
        console.warn("Phone command failed:", error);
    }
}

function startPhoneVideo() {
    dispenseAllowed = false;
    const button = document.getElementById("finish-btn");
    if (button) {
        button.disabled = true;
        button.classList.remove("dispense-ready");
        button.textContent = "WAITING FOR DOSE VIDEO…";
    }
    systemStatus.textContent = "LOOK AT THE DISPENSER";
    sendPhoneCommand("start", activeCareSet.video);
    waitForPhoneVideoCompletion();
}

function stopPhoneVideo() {
    if (phoneCompletionPoll) {
        clearTimeout(phoneCompletionPoll);
        phoneCompletionPoll = null;
    }
    sendPhoneCommand("stop");
}

async function waitForPhoneVideoCompletion() {
    if (phoneCompletionPoll) clearTimeout(phoneCompletionPoll);

    try {
        const response = await fetch("/api/phone/state?ts=" + Date.now(), {
            cache: "no-store"
        });
        const data = await response.json();

        if (data.command === "completed") {
            dispenseAllowed = true;
            const button = document.getElementById("finish-btn");
            if (button && !dispenseLocked) {
                button.disabled = false;
                button.classList.add("dispense-ready");
                button.textContent = "DISPENSE DOSE";
            }
            systemStatus.textContent = "VIDEO COMPLETE // DOSE READY";
            return;
        }
    } catch (error) {
        // Keep polling; the phone can reconnect without breaking the UI.
    }

    phoneCompletionPoll = setTimeout(waitForPhoneVideoCompletion, 250);
}


// ============================================
// BODY SCAN
// ============================================

function startBodyScan() {

    dispenseLocked = false;
    dispenseAllowed = false;

    const button = document.getElementById("finish-btn");
    if (button) {
        button.disabled = true;
        button.classList.remove("dispense-locked", "dispense-ready");
        button.textContent = "WAITING FOR DOSE VIDEO…";
    }

    const randomIndex = Math.floor(Math.random() * careSets.length);
    renderCareSet(careSets[randomIndex]);

    // Start the pill poly-printing video on the Android phone
    // exactly when BODY SCAN begins.
    startPhoneVideo();

    showScreen("data-screen");

    systemStatus.textContent =
        "ANALYSING HEALTH DATA";

    // Keep the body/data scan visibly active for longer before revealing
    // the care record. The phone video continues during this analysis.
    setTimeout(() => {
        showScreen("medicine-screen");
        systemStatus.textContent = dispenseAllowed
            ? "VIDEO COMPLETE // DOSE READY"
            : "CARE RECORD READY // WAITING FOR VIDEO";
    }, 6000);
}


// ============================================
// NORMAL MOUSE FALLBACK
// ============================================

document
    .addEventListener(
        "click",
        event => {

            const target =
                event.target.closest(
                    "button"
                );


            if (!target) return;


            if (
                target.id ===
                "begin-btn"
            ) return;


            if (
                target.id ===
                "continue-hand"
            ) return;


            activateElement(
                target
            );

        }
    );


// ============================================
// CAMERA + MEDIAPIPE LOOP
// ============================================

async function detectionLoop() {

    if (!modelsReady || video.readyState < 2) {
        requestAnimationFrame(detectionLoop);
        return;
    }

    // Never queue old webcam frames. If MediaPipe is still processing one,
    // skip incoming frames so gesture latency stays low.
    if (detectionBusy || video.currentTime === lastVideoTime) {
        requestAnimationFrame(detectionLoop);
        return;
    }

    detectionBusy = true;
    lastVideoTime = video.currentTime;
    const timestamp = performance.now();

    try {
        // Face tracking is only needed while scanning or during the dose gesture.
        // Hand tracking gets the processing headroom during navigation.
        if (faceScanning || currentScreen === "dose-screen") {
            try {
                const faceResult = faceLandmarker.detectForVideo(video, timestamp);
                processFace(faceResult);
            } catch (error) {
                console.error("Face detection:", error);
            }
        }

        try {
            const handResult = handLandmarker.detectForVideo(video, timestamp);
            processHands(handResult);
        } catch (error) {
            console.error("Hand detection:", error);
        }
    } finally {
        detectionBusy = false;
        requestAnimationFrame(detectionLoop);
    }
}


// ============================================
// START EVERYTHING
// ============================================

async function init() {

    try {

        await startCamera();

        await initializeMediaPipe();

        detectionLoop();

    } catch (error) {

        console.error(
            "Initialisation failed:",
            error
        );

        systemStatus.textContent =
            "SYSTEM ERROR";

    }

}

init();