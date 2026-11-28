import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function rand(min, max) { return min + Math.random() * (max - min); }

/** Speckle a region with translucent noise dots. */
function speckle(ctx, x, y, w, h, count, alpha, dark = true) {
  for (let i = 0; i < count; i++) {
    const shade = dark ? rand(0, 60) : rand(160, 255);
    ctx.fillStyle = `rgba(${shade},${shade * 0.92},${shade * 0.8},${rand(0.02, alpha)})`;
    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, rand(1, 3), rand(1, 3));
  }
}


function weathering(ctx, size, count, rgb, opacity, stretch = 1) {
  for (let i = 0; i < count; i++) {
    const x = rand(0, size), y = rand(0, size), r = rand(size * 0.03, size * 0.24);
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      if (Math.abs(x + dx - size / 2) > size / 2 + r ||
          Math.abs(y + dy - size / 2) > size / 2 + r * stretch) continue;
      ctx.save();
      ctx.translate(x + dx, y + dy);
      ctx.scale(1, stretch);
      const smudge = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      smudge.addColorStop(0, `rgba(${rgb},${opacity})`);
      smudge.addColorStop(0.63, `rgba(${rgb},${opacity * 0.38})`);
      smudge.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = smudge;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
  }
}

function fracture(ctx, x, y, dx, dy, segments) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < segments; i++) {
    x += dx * rand(0.4, 1.2);
    y += dy + rand(-4, 4);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  return [x, y];
}

function grain(ctx, width, height, count) {
  for (let i = 0; i < count; i++) {
    const y = rand(0, height), phase = rand(0, Math.PI * 2);
    const sway = rand(0.4, 3.5);
    ctx.strokeStyle = i % 4 === 0 ? 'rgba(192,139,86,0.18)' : 'rgba(24,14,10,0.34)';
    ctx.lineWidth = rand(0.45, 1.65);
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(phase) * sway);
    for (let x = 8; x <= width; x += 8) {
      const a = x / width * Math.PI * 2;
      ctx.lineTo(x, y + Math.sin(a + phase) * sway + Math.sin(3 * a) * 0.5);
    }
    ctx.stroke();
  }
}

export function woodFloor() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  for (let row = 0; row < 8; row++) {
    const y = row * 64, seam = rand(75, 435);
    const leftTone = rand(58, 87);
    const rightTone = leftTone + rand(7, 15) * (row % 2 ? 1 : -1);
    ctx.save();
    ctx.translate(0, y);
    ctx.beginPath();
    ctx.rect(0, 0, 512, 64);
    ctx.clip();
    // Blend across the tile boundary, which runs through a board.
    const boardColor = tone => `rgb(${tone + 18},${tone},${tone - 16})`;
    const boards = ctx.createLinearGradient(0, 0, 512, 0);
    const split = seam / 512;
    const wrapTone = (leftTone + rightTone) / 2;
    boards.addColorStop(0, boardColor(wrapTone));
    boards.addColorStop(split * 0.45, boardColor(leftTone));
    boards.addColorStop(split, boardColor(leftTone));
    boards.addColorStop(split + 0.002, boardColor(rightTone));
    boards.addColorStop(split + (1 - split) * 0.55, boardColor(rightTone));
    boards.addColorStop(1, boardColor(wrapTone));
    ctx.fillStyle = boards;
    ctx.fillRect(0, 0, 512, 64);
    const wear = ctx.createLinearGradient(seam, 0, seam + 72, 0);
    wear.addColorStop(0, row % 2 ? 'rgba(181,133,89,0.35)' : 'rgba(26,17,12,0.35)');
    wear.addColorStop(1, 'rgba(105,79,58,0)');
    ctx.fillStyle = wear;
    ctx.fillRect(seam, 0, 72, 64);
    grain(ctx, 512, 64, 90);
    const kx = rand(24, 488), ky = rand(15, 49);
    for (let ring = 1; ring < 6; ring++) {
      ctx.strokeStyle = 'rgba(33,19,12,0.46)';
      ctx.beginPath();
      ctx.ellipse(kx, ky, ring * 3.8, ring * 0.95, -0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
    speckle(ctx, 0, 0, 512, 64, 190, 0.2);
    ctx.strokeStyle = 'rgba(219,175,125,0.31)';
    ctx.lineWidth = 0.75;
    for (let i = 0; i < 7; i++) fracture(ctx, rand(10, 475), rand(7, 57), rand(1, 5), 0, 5);
    ctx.strokeStyle = '#302016';
    fracture(ctx, seam, rand(12, 50), -7, 0, 7);
    ctx.fillStyle = '#231812';
    ctx.fillRect(0, 0, 512, 2.5);
    ctx.fillRect(seam, 0, 2.3, 64);
    ctx.fillStyle = 'rgba(221,176,126,0.29)';
    ctx.fillRect(0, 3, 512, 1);
    ctx.fillRect(seam + 2.3, 3, 1, 61);
    for (const x of [seam - 7, seam + 9]) {
      for (const y of [12, 50]) {
        ctx.fillStyle = '#352a20';
        ctx.beginPath();
        ctx.arc(x, y, 1.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  weathering(ctx, 512, 12, '23,22,16', 0.47, 0.53);
  weathering(ctx, 512, 8, '166,134,92', 0.24, 0.35);
  return toTexture(c);
}

export function wallpaper() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#655b46';
  ctx.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 64) {
    ctx.fillStyle = '#5e5541';
    ctx.fillRect(x + 2, 0, 15, 512);
    ctx.fillStyle = '#756951';
    ctx.fillRect(x + 18, 0, 1, 512);
    for (let y = 0; y < 512; y += 64) {
      ctx.save();
      ctx.translate(x + 42, y + 32);
      ctx.fillStyle = 'rgba(47,52,39,0.66)';
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.scale(side, 1);
        ctx.beginPath();
        ctx.moveTo(0, 25);
        ctx.bezierCurveTo(1, 2, 27, 9, 18, -7);
        ctx.bezierCurveTo(14, -15, 6, -6, 12, -4);
        ctx.bezierCurveTo(14, 4, 1, -3, 1, -13);
        ctx.quadraticCurveTo(1, -19, 0, -25);
        ctx.quadraticCurveTo(8, -18, 10, -12);
        ctx.bezierCurveTo(26, -22, 31, 13, 8, 15);
        ctx.quadraticCurveTo(5, 18, 0, 25);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }
  weathering(ctx, 512, 9, '170,150,117', 0.67);
  for (const [x, y, width, height] of [[112, 391, 57, 81], [403, 149, 32, 82], [245, 464, 29, 34]]) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const angle = i / 18 * Math.PI * 2;
      const edge = rand(0.55, 1);
      ctx.lineTo(x + Math.cos(angle) * width * edge, y + Math.sin(angle) * height * edge);
    }
    ctx.closePath();
    ctx.fillStyle = '#827664';
    ctx.fill();
    ctx.strokeStyle = '#342c22';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.clip();
    speckle(ctx, x - width, y - height, width * 2, height * 2, 650, 0.28);
    ctx.strokeStyle = '#b0a086';
    ctx.lineWidth = 6;
    ctx.translate(-2, -4);
    ctx.stroke();
    ctx.restore();
  }
  weathering(ctx, 512, 15, '38,36,23', 0.56, 1.5);
  speckle(ctx, 0, 0, 512, 512, 2400, 0.2);
  return toTexture(c);
}

export function plaster() {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#777066';
  ctx.fillRect(0, 0, 512, 512);
  weathering(ctx, 512, 18, '53,42,27', 0.53);
  weathering(ctx, 512, 10, '181,167,145', 0.39);
  speckle(ctx, 0, 0, 512, 512, 4800, 0.24);
  speckle(ctx, 0, 0, 512, 512, 2500, 0.19, false);
  for (let i = 0; i < 13; i++) {
    ctx.strokeStyle = 'rgba(42,35,25,0.62)';
    ctx.lineWidth = rand(0.5, 1.5);
    const [x, y] = fracture(ctx, rand(25, 445), rand(25, 460), rand(2, 7), rand(-4, 5), 8);
    ctx.lineWidth *= 0.55;
    fracture(ctx, x, y, -3, -4, 5);
    fracture(ctx, x, y, 4, 2, 6);
  }
  return toTexture(c);
}

export function darkWood() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4c3225';
  ctx.fillRect(0, 0, 256, 256);
  grain(ctx, 256, 256, 275);
  weathering(ctx, 256, 13, '150,104,64', 0.41, 0.38);
  weathering(ctx, 256, 10, '29,21,16', 0.49, 0.65);
  speckle(ctx, 0, 0, 256, 256, 900, 0.2);
  ctx.strokeStyle = 'rgba(181,147,106,0.28)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 32; i++) fracture(ctx, rand(10, 220), rand(8, 248), 3, rand(-2, 2), 5);
  return toTexture(c);
}

export function fabric(baseR = 77, baseG = 52, baseB = 53) {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    for (let x = (y % 4); x < 256; x += 4) {
      ctx.fillStyle = 'rgba(185,166,144,0.21)';
      ctx.fillRect(x, y, 3, 1);
      ctx.fillStyle = 'rgba(26,22,20,0.29)';
      ctx.fillRect(x + 2, y, 1, 2);
    }
  }
  weathering(ctx, 256, 10, '142,125,106', 0.38);
  weathering(ctx, 256, 7, '30,28,23', 0.37);
  speckle(ctx, 0, 0, 256, 256, 950, 0.17, false);
  ctx.strokeStyle = 'rgba(34,26,22,0.44)';
  ctx.strokeRect(5, 5, 246, 246);
  ctx.strokeStyle = 'rgba(176,148,124,0.36)';
  ctx.setLineDash([2, 3]);
  ctx.strokeRect(7, 7, 242, 242);
  return toTexture(c);
}

export function oldGlass() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#62799a');
  sky.addColorStop(0.58, '#364961');
  sky.addColorStop(1, '#19283a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 256, 256);
  weathering(ctx, 256, 14, '30,32,38', 0.61, 1.6);
  weathering(ctx, 256, 10, '143,149,150', 0.34, 1.8);
  speckle(ctx, 0, 0, 256, 256, 1250, 0.24);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(178,188,203,0.62)';
  const [x, y] = fracture(ctx, 15, 178, 5, -3, 9);
  fracture(ctx, x, y, 2, -4, 5);
  fracture(ctx, x, y, 3, 2, 4);
  fracture(ctx, 239, 15, -3, 3, 11);
  return toTexture(c);
}

/**
 * A pale gaunt face for the portraits.
 * variant 0: staring ? 1: mouth torn wide open ? 2: hollow black eyes
 */
export function drawFace(ctx, size, intensity = 1, variant = 0) {
  const cx = size / 2, cy = size / 2;
  const mouthScale = variant === 1 ? 2.1 : 1;
  const eyeScale = variant === 2 ? 1.7 : 1;
  const showPupils = variant !== 2;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  // head shape ? elongated pale oval
  let grad = ctx.createRadialGradient(cx, cy * 0.92, size * 0.05, cx, cy, size * 0.42);
  grad.addColorStop(0, `rgba(${168 * intensity},${164 * intensity},${158 * intensity},1)`);
  grad.addColorStop(0.72, `rgba(${110 * intensity},${104 * intensity},${100 * intensity},1)`);
  grad.addColorStop(1, 'rgba(10,10,10,0)');
  ctx.fillStyle = grad;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(0.72, 1.0);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // sunken eye sockets
  for (const sx of [-1, 1]) {
    const ex = cx + sx * size * 0.115, ey = cy - size * 0.07;
    grad = ctx.createRadialGradient(ex, ey, 1, ex, ey, size * 0.085 * eyeScale);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.65, 'rgba(5,4,4,0.95)');
    grad.addColorStop(1, 'rgba(5,4,4,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(ex, ey, size * 0.075 * eyeScale, size * 0.095 * eyeScale, 0, 0, Math.PI * 2);
    ctx.fill();
    if (showPupils) {
      // pinprick glowing pupils
      ctx.fillStyle = 'rgba(220,228,235,0.95)';
      ctx.beginPath();
      ctx.arc(ex, ey + size * 0.012, size * 0.011, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // long dark nose shadow
  grad = ctx.createLinearGradient(cx, cy - size * 0.02, cx, cy + size * 0.12);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - size * 0.022, cy - size * 0.02, size * 0.044, size * 0.14);
  // gaping vertical mouth
  grad = ctx.createRadialGradient(cx, cy + size * 0.21, 2, cx, cy + size * 0.21, size * 0.11 * mouthScale);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.8, 'rgba(8,4,4,0.92)');
  grad.addColorStop(1, 'rgba(8,4,4,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.21, size * 0.052 * mouthScale, size * 0.105 * mouthScale, 0, 0, Math.PI * 2);
  ctx.fill();
  if (variant === 1) {
    // strained jaw shadow lines around the torn mouth
    ctx.strokeStyle = 'rgba(20,12,10,0.7)';
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.28;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * size * 0.06, cy + size * 0.21 + Math.sin(a) * size * 0.1);
      ctx.lineTo(cx + Math.cos(a) * size * 0.13, cy + size * 0.21 + Math.sin(a) * size * 0.22);
      ctx.stroke();
    }
  }
  // grime streaks down the face
  ctx.strokeStyle = 'rgba(30,26,24,0.35)';
  for (let i = 0; i < 24; i++) {
    const x = cx + rand(-size * 0.26, size * 0.26);
    ctx.lineWidth = rand(0.5, 2);
    ctx.beginPath();
    ctx.moveTo(x, cy - size * 0.3);
    ctx.lineTo(x + rand(-8, 8), cy + rand(size * 0.1, size * 0.34));
    ctx.stroke();
  }
}

export function ghostSmokeTexture() {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  const falloff = ctx.createRadialGradient(14, 15, 1, 16, 16, 16);
  falloff.addColorStop(0, 'rgba(255,255,255,0.86)');
  falloff.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  falloff.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = falloff;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export function ghostFaceDataURL() {
  const c = makeCanvas(384, 384);
  const ctx = c.getContext('2d');
  const skin = ctx.createRadialGradient(150, 85, 18, 192, 171, 190);
  skin.addColorStop(0, '#5b5759');
  skin.addColorStop(0.48, '#303035');
  skin.addColorStop(1, '#060608');
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.moveTo(72, 384);
  ctx.bezierCurveTo(90, 323, 147, 325, 158, 282);
  ctx.bezierCurveTo(105, 233, 106, 174, 106, 122);
  ctx.bezierCurveTo(106, 66, 121, 32, 154, 29);
  ctx.bezierCurveTo(172, 8, 216, 44, 238, 56);
  ctx.bezierCurveTo(258, 80, 264, 123, 265, 151);
  ctx.bezierCurveTo(284, 196, 247, 265, 227, 300);
  ctx.bezierCurveTo(229, 342, 311, 332, 330, 384);
  ctx.closePath();
  ctx.fill();

  for (const [x, y, angle] of [[148, 157, -0.19], [218, 166, 0.16]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const socket = ctx.createRadialGradient(0, 0, 4, 0, 0, 32);
    socket.addColorStop(0.3, '#08080b');
    socket.addColorStop(1, 'rgba(8,8,11,0)');
    ctx.fillStyle = socket;
    ctx.fillRect(-32, -32, 64, 64);
    ctx.strokeStyle = '#464146';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-18, -9);
    ctx.quadraticCurveTo(0, -20, 17, -9);
    ctx.stroke();
    ctx.fillStyle = '#a7abaa';
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#09070b';
  ctx.beginPath();
  ctx.moveTo(126, 203);
  ctx.bezierCurveTo(151, 229, 203, 251, 244, 209);
  ctx.bezierCurveTo(223, 266, 155, 251, 126, 203);
  ctx.fill();
  ctx.strokeStyle = '#625851';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(141, 217);
  ctx.bezierCurveTo(168, 239, 207, 245, 235, 218);
  ctx.stroke();
  speckle(ctx, 0, 0, 384, 384, 1100, 0.12, true);
  return c.toDataURL();
}

/** Dusty cobweb on a transparent plane. */
export function cobweb() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(190,188,180,0.55)';
  const cx = 12, cy = 12; // anchored in a corner
  // radial threads
  const spokes = [];
  for (let i = 0; i <= 7; i++) {
    const a = (i / 7) * (Math.PI / 2) + rand(-0.045, 0.045);
    spokes.push(a);
    ctx.lineWidth = rand(0.55, 1.25);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a) * 110 - 5, cy + Math.sin(a) * 110 + 4,
      cx + Math.cos(a) * 240, cy + Math.sin(a) * 240);
    ctx.stroke();
  }
  // sagging connecting arcs
  for (let r = 30; r < 240; r += 24 + Math.random() * 14) {
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let i = 0; i < spokes.length - 1; i++) {
      const a0 = spokes[i], a1 = spokes[i + 1];
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      const mx = (x0 + x1) / 2 + Math.cos((a0 + a1) / 2) * 8;
      const my = (y0 + y1) / 2 + Math.sin((a0 + a1) / 2) * 8;
      ctx.moveTo(x0, y0);
      if (r > 90 && Math.random() < 0.19) continue;
      ctx.quadraticCurveTo(mx, my, x1, y1);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Radial falloff cookie so the flashlight beam has soft texture, not a hard disc. */
export function flashlightCookie() {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.22, '#fff');
  grad.addColorStop(0.48, '#e8e8e8');
  grad.addColorStop(0.72, '#a0a0a0');
  grad.addColorStop(0.9, '#363636');
  grad.addColorStop(1, '#000');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Old portrait painting ? dim hooded figure. */
export function portrait() {
  const c = makeCanvas(256, 320);
  const ctx = c.getContext('2d');
  let grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, '#241c12');
  grad.addColorStop(1, '#0d0a06');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 320);
  // shoulders
  ctx.fillStyle = '#0a0805';
  ctx.beginPath();
  ctx.ellipse(128, 320, 120, 110, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // dim face
  ctx.save();
  ctx.translate(128, 150);
  ctx.scale(0.42, 0.42);
  ctx.translate(-128, -128);
  drawFace(ctx, 256, 0.45);
  ctx.restore();
  // dark hood over face
  ctx.fillStyle = 'rgba(5,4,3,0.55)';
  ctx.beginPath();
  ctx.ellipse(128, 110, 70, 64, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // varnish cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  for (let k = 0; k < 16; k++) {
    let x = rand(0, 256), y = rand(0, 320);
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += rand(-25, 25); y += rand(-25, 25); ctx.lineTo(x, y); }
    ctx.stroke();
  }
  speckle(ctx, 0, 0, 256, 320, 1800, 0.19, false);
  const vignette = ctx.createRadialGradient(130, 145, 65, 130, 145, 180);
  vignette.addColorStop(0, 'rgba(39,29,17,0)');
  vignette.addColorStop(1, 'rgba(13,9,7,0.74)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 256, 320);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Old paper note texture (for 3D note meshes). */
export function paper() {
  const c = makeCanvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c9bda2';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, 0, 0, 128, 128, 250, 0.12);
  ctx.strokeStyle = 'rgba(60,48,30,0.5)';
  for (let y = 24; y < 120; y += 12) {
    ctx.beginPath();
    ctx.moveTo(14, y);
    ctx.lineTo(114, y + rand(-1, 1));
    ctx.stroke();
  }
  return toTexture(c);
}

/** Film grain tile for the CSS overlay. */
export function grainDataURL() {
  const c = makeCanvas(160, 160);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}
