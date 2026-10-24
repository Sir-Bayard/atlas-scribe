/*!
 * Clipper2 (polygon clipping and offsetting) by Angus Johnson, https://www.angusj.com
 * TypeScript port: @countertype/clipper2-ts 1.5.4-3.9a869ba by Jeremy Tribby, https://github.com/countertype/clipper2-ts
 * Copyright Angus Johnson 2010-2025. Boost Software License 1.0: see clipper2-LICENSE.txt beside this file.
 * Bundled unchanged into one ES module for AtlasScribe with esbuild 0.24.0 (src/index.ts, --bundle --format=esm).
 */
// pkg/package/src/Core.ts
var ClipType = /* @__PURE__ */ ((ClipType2) => {
  ClipType2[ClipType2["NoClip"] = 0] = "NoClip";
  ClipType2[ClipType2["Intersection"] = 1] = "Intersection";
  ClipType2[ClipType2["Union"] = 2] = "Union";
  ClipType2[ClipType2["Difference"] = 3] = "Difference";
  ClipType2[ClipType2["Xor"] = 4] = "Xor";
  return ClipType2;
})(ClipType || {});
var PathType = /* @__PURE__ */ ((PathType2) => {
  PathType2[PathType2["Subject"] = 0] = "Subject";
  PathType2[PathType2["Clip"] = 1] = "Clip";
  return PathType2;
})(PathType || {});
var FillRule = /* @__PURE__ */ ((FillRule3) => {
  FillRule3[FillRule3["EvenOdd"] = 0] = "EvenOdd";
  FillRule3[FillRule3["NonZero"] = 1] = "NonZero";
  FillRule3[FillRule3["Positive"] = 2] = "Positive";
  FillRule3[FillRule3["Negative"] = 3] = "Negative";
  return FillRule3;
})(FillRule || {});
var PointInPolygonResult = /* @__PURE__ */ ((PointInPolygonResult3) => {
  PointInPolygonResult3[PointInPolygonResult3["IsOn"] = 0] = "IsOn";
  PointInPolygonResult3[PointInPolygonResult3["IsInside"] = 1] = "IsInside";
  PointInPolygonResult3[PointInPolygonResult3["IsOutside"] = 2] = "IsOutside";
  return PointInPolygonResult3;
})(PointInPolygonResult || {});
var InternalClipper;
((InternalClipper2) => {
  InternalClipper2.MaxInt64 = 9223372036854775807n;
  InternalClipper2.MaxCoord = Number(InternalClipper2.MaxInt64 / 4n);
  InternalClipper2.max_coord = InternalClipper2.MaxCoord;
  InternalClipper2.min_coord = -InternalClipper2.MaxCoord;
  InternalClipper2.Invalid64 = Number(InternalClipper2.MaxInt64);
  InternalClipper2.floatingPointTolerance = 1e-12;
  InternalClipper2.defaultMinimumEdgeLength = 0.1;
  function crossProduct(pt1, pt2, pt3) {
    return (pt2.x - pt1.x) * (pt3.y - pt2.y) - (pt2.y - pt1.y) * (pt3.x - pt2.x);
  }
  InternalClipper2.crossProduct = crossProduct;
  function crossProductSign(pt1, pt2, pt3) {
    const a = pt2.x - pt1.x;
    const b = pt3.y - pt2.y;
    const c = pt2.y - pt1.y;
    const d = pt3.x - pt2.x;
    const ab = multiplyUInt64(Math.abs(a), Math.abs(b));
    const cd = multiplyUInt64(Math.abs(c), Math.abs(d));
    const signAB = triSign(a) * triSign(b);
    const signCD = triSign(c) * triSign(d);
    if (signAB === signCD) {
      let result;
      if (ab.hi64 === cd.hi64) {
        if (ab.lo64 === cd.lo64) return 0;
        result = ab.lo64 > cd.lo64 ? 1 : -1;
      } else {
        result = ab.hi64 > cd.hi64 ? 1 : -1;
      }
      return signAB > 0 ? result : -result;
    }
    return signAB > signCD ? 1 : -1;
  }
  InternalClipper2.crossProductSign = crossProductSign;
  function checkPrecision(precision) {
    if (precision < -8 || precision > 8) {
      throw new Error("Error: Precision is out of range.");
    }
  }
  InternalClipper2.checkPrecision = checkPrecision;
  function isAlmostZero(value) {
    return Math.abs(value) <= InternalClipper2.floatingPointTolerance;
  }
  InternalClipper2.isAlmostZero = isAlmostZero;
  function triSign(x) {
    return x < 0 ? -1 : x > 0 ? 1 : 0;
  }
  InternalClipper2.triSign = triSign;
  function multiplyUInt64(a, b) {
    const aBig = BigInt(a >>> 0);
    const bBig = BigInt(b >>> 0);
    const x1 = (aBig & 0xFFFFFFFFn) * (bBig & 0xFFFFFFFFn);
    const x2 = (aBig >> 32n) * (bBig & 0xFFFFFFFFn) + (x1 >> 32n);
    const x3 = (aBig & 0xFFFFFFFFn) * (bBig >> 32n) + (x2 & 0xFFFFFFFFn);
    const lobits = (x3 & 0xFFFFFFFFn) << 32n | x1 & 0xFFFFFFFFn;
    const hibits = (aBig >> 32n) * (bBig >> 32n) + (x2 >> 32n) + (x3 >> 32n);
    return {
      lo64: Number(lobits & 0xFFFFFFFFFFFFFFFFn),
      hi64: Number(hibits & 0xFFFFFFFFFFFFFFFFn)
    };
  }
  InternalClipper2.multiplyUInt64 = multiplyUInt64;
  function productsAreEqual(a, b, c, d) {
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    const absC = Math.abs(c);
    const absD = Math.abs(d);
    if (absA < 46341 && absB < 46341 && absC < 46341 && absD < 46341) {
      return a * b === c * d;
    }
    const mulAb = multiplyUInt64(absA, absB);
    const mulCd = multiplyUInt64(absC, absD);
    const signAb = triSign(a) * triSign(b);
    const signCd = triSign(c) * triSign(d);
    return mulAb.lo64 === mulCd.lo64 && mulAb.hi64 === mulCd.hi64 && signAb === signCd;
  }
  InternalClipper2.productsAreEqual = productsAreEqual;
  function isCollinear(pt1, sharedPt, pt2) {
    const a = sharedPt.x - pt1.x;
    const b = pt2.y - sharedPt.y;
    const c = sharedPt.y - pt1.y;
    const d = pt2.x - sharedPt.x;
    return productsAreEqual(a, b, c, d);
  }
  InternalClipper2.isCollinear = isCollinear;
  function dotProduct(pt1, pt2, pt3) {
    return (pt2.x - pt1.x) * (pt3.x - pt2.x) + (pt2.y - pt1.y) * (pt3.y - pt2.y);
  }
  InternalClipper2.dotProduct = dotProduct;
  function crossProductD(vec1, vec2) {
    return vec1.y * vec2.x - vec2.y * vec1.x;
  }
  InternalClipper2.crossProductD = crossProductD;
  function dotProductD(vec1, vec2) {
    return vec1.x * vec2.x + vec1.y * vec2.y;
  }
  InternalClipper2.dotProductD = dotProductD;
  function roundToEven(value) {
    const floor = Math.floor(value);
    const diff = value - floor;
    if (Math.abs(diff - 0.5) < 1e-10) {
      return floor % 2 === 0 ? floor : floor + 1;
    }
    return Math.round(value);
  }
  InternalClipper2.roundToEven = roundToEven;
  function checkCastInt64(val) {
    if (val >= InternalClipper2.max_coord || val <= InternalClipper2.min_coord) return InternalClipper2.Invalid64;
    return Math.round(val);
  }
  InternalClipper2.checkCastInt64 = checkCastInt64;
  function getLineIntersectPt(ln1a, ln1b, ln2a, ln2b) {
    const dy1 = ln1b.y - ln1a.y;
    const dx1 = ln1b.x - ln1a.x;
    const dy2 = ln2b.y - ln2a.y;
    const dx2 = ln2b.x - ln2a.x;
    const det = dy1 * dx2 - dy2 * dx1;
    if (det === 0) {
      return { intersects: false, point: { x: 0, y: 0 } };
    }
    const t = ((ln1a.x - ln2a.x) * dy2 - (ln1a.y - ln2a.y) * dx2) / det;
    let ip;
    if (t <= 0) {
      ip = { x: ln1a.x, y: ln1a.y };
    } else if (t >= 1) {
      ip = { x: ln1b.x, y: ln1b.y };
    } else {
      const rawX = ln1a.x + t * dx1;
      const rawY = ln1a.y + t * dy1;
      ip = {
        x: Math.trunc(rawX),
        y: Math.trunc(rawY)
      };
    }
    return { intersects: true, point: ip };
  }
  InternalClipper2.getLineIntersectPt = getLineIntersectPt;
  function getLineIntersectPtD(ln1a, ln1b, ln2a, ln2b) {
    const dy1 = ln1b.y - ln1a.y;
    const dx1 = ln1b.x - ln1a.x;
    const dy2 = ln2b.y - ln2a.y;
    const dx2 = ln2b.x - ln2a.x;
    const det = dy1 * dx2 - dy2 * dx1;
    if (det === 0) {
      return { success: false, ip: { x: 0, y: 0 } };
    }
    const t = ((ln1a.x - ln2a.x) * dy2 - (ln1a.y - ln2a.y) * dx2) / det;
    let ip;
    if (t <= 0) {
      ip = { ...ln1a };
    } else if (t >= 1) {
      ip = { ...ln1b };
    } else {
      ip = {
        x: ln1a.x + t * dx1,
        y: ln1a.y + t * dy1
      };
    }
    return { success: true, ip };
  }
  InternalClipper2.getLineIntersectPtD = getLineIntersectPtD;
  function segsIntersect(seg1a, seg1b, seg2a, seg2b, inclusive = false) {
    if (!inclusive) {
      return crossProduct(seg1a, seg2a, seg2b) * crossProduct(seg1b, seg2a, seg2b) < 0 && crossProduct(seg2a, seg1a, seg1b) * crossProduct(seg2b, seg1a, seg1b) < 0;
    }
    const res1 = crossProduct(seg1a, seg2a, seg2b);
    const res2 = crossProduct(seg1b, seg2a, seg2b);
    if (res1 * res2 > 0) return false;
    const res3 = crossProduct(seg2a, seg1a, seg1b);
    const res4 = crossProduct(seg2b, seg1a, seg1b);
    if (res3 * res4 > 0) return false;
    return res1 !== 0 || res2 !== 0 || res3 !== 0 || res4 !== 0;
  }
  InternalClipper2.segsIntersect = segsIntersect;
  function getBounds2(path) {
    if (path.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
    const result = {
      left: Number.MAX_SAFE_INTEGER,
      top: Number.MAX_SAFE_INTEGER,
      right: Number.MIN_SAFE_INTEGER,
      bottom: Number.MIN_SAFE_INTEGER
    };
    for (const pt of path) {
      if (pt.x < result.left) result.left = pt.x;
      if (pt.x > result.right) result.right = pt.x;
      if (pt.y < result.top) result.top = pt.y;
      if (pt.y > result.bottom) result.bottom = pt.y;
    }
    return result.left === Number.MAX_SAFE_INTEGER ? { left: 0, top: 0, right: 0, bottom: 0 } : result;
  }
  InternalClipper2.getBounds = getBounds2;
  function getClosestPtOnSegment(offPt, seg1, seg2) {
    if (seg1.x === seg2.x && seg1.y === seg2.y) return { x: seg1.x, y: seg1.y };
    const dx = seg2.x - seg1.x;
    const dy = seg2.y - seg1.y;
    const q = ((offPt.x - seg1.x) * dx + (offPt.y - seg1.y) * dy) / (dx * dx + dy * dy);
    const qClamped = q < 0 ? 0 : q > 1 ? 1 : q;
    return {
      // use Math.round to match the C# MidpointRounding.ToEven behavior
      x: Math.round(seg1.x + qClamped * dx),
      y: Math.round(seg1.y + qClamped * dy)
    };
  }
  InternalClipper2.getClosestPtOnSegment = getClosestPtOnSegment;
  function pointInPolygon2(pt, polygon) {
    const len = polygon.length;
    let start = 0;
    if (len < 3) return 2 /* IsOutside */;
    while (start < len && polygon[start].y === pt.y) start++;
    if (start === len) return 2 /* IsOutside */;
    let isAbove = polygon[start].y < pt.y;
    const startingAbove = isAbove;
    let val = 0;
    let i = start + 1;
    let end = len;
    while (true) {
      if (i === end) {
        if (end === 0 || start === 0) break;
        end = start;
        i = 0;
      }
      if (isAbove) {
        while (i < end && polygon[i].y < pt.y) i++;
      } else {
        while (i < end && polygon[i].y > pt.y) i++;
      }
      if (i === end) continue;
      const curr = polygon[i];
      const prev = i > 0 ? polygon[i - 1] : polygon[len - 1];
      if (curr.y === pt.y) {
        if (curr.x === pt.x || curr.y === prev.y && pt.x < prev.x !== pt.x < curr.x) {
          return 0 /* IsOn */;
        }
        i++;
        if (i === start) break;
        continue;
      }
      if (pt.x < curr.x && pt.x < prev.x) {
      } else if (pt.x > prev.x && pt.x > curr.x) {
        val = 1 - val;
      } else {
        const cps2 = crossProductSign(prev, curr, pt);
        if (cps2 === 0) return 0 /* IsOn */;
        if (cps2 < 0 === isAbove) val = 1 - val;
      }
      isAbove = !isAbove;
      i++;
    }
    if (isAbove === startingAbove) {
      return val === 0 ? 2 /* IsOutside */ : 1 /* IsInside */;
    }
    if (i === len) i = 0;
    const cps = i === 0 ? crossProductSign(polygon[len - 1], polygon[0], pt) : crossProductSign(polygon[i - 1], polygon[i], pt);
    if (cps === 0) return 0 /* IsOn */;
    if (cps < 0 === isAbove) val = 1 - val;
    return val === 0 ? 2 /* IsOutside */ : 1 /* IsInside */;
  }
  InternalClipper2.pointInPolygon = pointInPolygon2;
  function path2ContainsPath1(path1, path2) {
    let pip = 0 /* IsOn */;
    for (const pt of path1) {
      switch (pointInPolygon2(pt, path2)) {
        case 2 /* IsOutside */:
          if (pip === 2 /* IsOutside */) return false;
          pip = 2 /* IsOutside */;
          break;
        case 1 /* IsInside */:
          if (pip === 1 /* IsInside */) return true;
          pip = 1 /* IsInside */;
          break;
        default:
          break;
      }
    }
    const mp = getBounds2(path1);
    const midPt = {
      x: Math.round((mp.left + mp.right) / 2),
      y: Math.round((mp.top + mp.bottom) / 2)
    };
    return pointInPolygon2(midPt, path2) !== 2 /* IsOutside */;
  }
  InternalClipper2.path2ContainsPath1 = path2ContainsPath1;
})(InternalClipper || (InternalClipper = {}));
var Point64Utils;
((Point64Utils3) => {
  function create(x = 0, y = 0) {
    return { x: Math.round(x), y: Math.round(y) };
  }
  Point64Utils3.create = create;
  function fromPointD(pt) {
    return { x: Math.round(pt.x), y: Math.round(pt.y) };
  }
  Point64Utils3.fromPointD = fromPointD;
  function scale(pt, scale2) {
    return {
      x: Math.round(pt.x * scale2),
      y: Math.round(pt.y * scale2)
    };
  }
  Point64Utils3.scale = scale;
  function equals(a, b) {
    return a.x === b.x && a.y === b.y;
  }
  Point64Utils3.equals = equals;
  function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }
  Point64Utils3.add = add;
  function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  Point64Utils3.subtract = subtract;
  function toString(pt) {
    return `${pt.x},${pt.y} `;
  }
  Point64Utils3.toString = toString;
})(Point64Utils || (Point64Utils = {}));
var PointDUtils;
((PointDUtils3) => {
  function create(x = 0, y = 0) {
    return { x, y };
  }
  PointDUtils3.create = create;
  function fromPoint64(pt) {
    return { x: pt.x, y: pt.y };
  }
  PointDUtils3.fromPoint64 = fromPoint64;
  function scale(pt, scale2) {
    return { x: pt.x * scale2, y: pt.y * scale2 };
  }
  PointDUtils3.scale = scale;
  function equals(a, b) {
    return InternalClipper.isAlmostZero(a.x - b.x) && InternalClipper.isAlmostZero(a.y - b.y);
  }
  PointDUtils3.equals = equals;
  function negate(pt) {
    pt.x = -pt.x;
    pt.y = -pt.y;
  }
  PointDUtils3.negate = negate;
  function toString(pt, precision = 2) {
    return `${pt.x.toFixed(precision)},${pt.y.toFixed(precision)}`;
  }
  PointDUtils3.toString = toString;
})(PointDUtils || (PointDUtils = {}));
var Rect64Utils;
((Rect64Utils2) => {
  function create(l = 0, t = 0, r = 0, b = 0) {
    return { left: l, top: t, right: r, bottom: b };
  }
  Rect64Utils2.create = create;
  function createInvalid() {
    return {
      left: Number.MAX_SAFE_INTEGER,
      top: Number.MAX_SAFE_INTEGER,
      right: Number.MIN_SAFE_INTEGER,
      bottom: Number.MIN_SAFE_INTEGER
    };
  }
  Rect64Utils2.createInvalid = createInvalid;
  function width(rect) {
    return rect.right - rect.left;
  }
  Rect64Utils2.width = width;
  function height(rect) {
    return rect.bottom - rect.top;
  }
  Rect64Utils2.height = height;
  function isEmpty(rect) {
    return rect.bottom <= rect.top || rect.right <= rect.left;
  }
  Rect64Utils2.isEmpty = isEmpty;
  function isValid(rect) {
    return rect.left < Number.MAX_SAFE_INTEGER;
  }
  Rect64Utils2.isValid = isValid;
  function midPoint(rect) {
    return {
      x: Math.round((rect.left + rect.right) / 2),
      y: Math.round((rect.top + rect.bottom) / 2)
    };
  }
  Rect64Utils2.midPoint = midPoint;
  function contains(rect, pt) {
    return pt.x > rect.left && pt.x < rect.right && pt.y > rect.top && pt.y < rect.bottom;
  }
  Rect64Utils2.contains = contains;
  function containsRect(rect, rec) {
    return rec.left >= rect.left && rec.right <= rect.right && rec.top >= rect.top && rec.bottom <= rect.bottom;
  }
  Rect64Utils2.containsRect = containsRect;
  function intersects(rect, rec) {
    return Math.max(rect.left, rec.left) <= Math.min(rect.right, rec.right) && Math.max(rect.top, rec.top) <= Math.min(rect.bottom, rec.bottom);
  }
  Rect64Utils2.intersects = intersects;
  function asPath(rect) {
    return [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom }
    ];
  }
  Rect64Utils2.asPath = asPath;
})(Rect64Utils || (Rect64Utils = {}));
var RectDUtils;
((RectDUtils3) => {
  function create(l = 0, t = 0, r = 0, b = 0) {
    return { left: l, top: t, right: r, bottom: b };
  }
  RectDUtils3.create = create;
  function createInvalid() {
    return {
      left: Number.MAX_VALUE,
      top: Number.MAX_VALUE,
      right: -Number.MAX_VALUE,
      bottom: -Number.MAX_VALUE
    };
  }
  RectDUtils3.createInvalid = createInvalid;
  function width(rect) {
    return rect.right - rect.left;
  }
  RectDUtils3.width = width;
  function height(rect) {
    return rect.bottom - rect.top;
  }
  RectDUtils3.height = height;
  function isEmpty(rect) {
    return rect.bottom <= rect.top || rect.right <= rect.left;
  }
  RectDUtils3.isEmpty = isEmpty;
  function midPoint(rect) {
    return {
      x: (rect.left + rect.right) / 2,
      y: (rect.top + rect.bottom) / 2
    };
  }
  RectDUtils3.midPoint = midPoint;
  function contains(rect, pt) {
    return pt.x > rect.left && pt.x < rect.right && pt.y > rect.top && pt.y < rect.bottom;
  }
  RectDUtils3.contains = contains;
  function containsRect(rect, rec) {
    return rec.left >= rect.left && rec.right <= rect.right && rec.top >= rect.top && rec.bottom <= rect.bottom;
  }
  RectDUtils3.containsRect = containsRect;
  function intersects(rect, rec) {
    return Math.max(rect.left, rec.left) < Math.min(rect.right, rec.right) && Math.max(rect.top, rec.top) < Math.min(rect.bottom, rec.bottom);
  }
  RectDUtils3.intersects = intersects;
  function asPath(rect) {
    return [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom }
    ];
  }
  RectDUtils3.asPath = asPath;
})(RectDUtils || (RectDUtils = {}));
var PathUtils;
((PathUtils2) => {
  function toString64(path) {
    let result = "";
    for (const pt of path) {
      result += Point64Utils.toString(pt);
    }
    return result + "\n";
  }
  PathUtils2.toString64 = toString64;
  function toStringD(path, precision = 2) {
    let result = "";
    for (const pt of path) {
      result += PointDUtils.toString(pt, precision) + ", ";
    }
    if (result !== "") result = result.slice(0, -2);
    return result;
  }
  PathUtils2.toStringD = toStringD;
  function reverse64(path) {
    return [...path].reverse();
  }
  PathUtils2.reverse64 = reverse64;
  function reverseD(path) {
    return [...path].reverse();
  }
  PathUtils2.reverseD = reverseD;
})(PathUtils || (PathUtils = {}));
var PathsUtils;
((PathsUtils2) => {
  function toString64(paths) {
    let result = "";
    for (const path of paths) {
      result += PathUtils.toString64(path);
    }
    return result;
  }
  PathsUtils2.toString64 = toString64;
  function toStringD(paths, precision = 2) {
    let result = "";
    for (const path of paths) {
      result += PathUtils.toStringD(path, precision) + "\n";
    }
    return result;
  }
  PathsUtils2.toStringD = toStringD;
  function reverse64(paths) {
    return paths.map((path) => PathUtils.reverse64(path));
  }
  PathsUtils2.reverse64 = reverse64;
  function reverseD(paths) {
    return paths.map((path) => PathUtils.reverseD(path));
  }
  PathsUtils2.reverseD = reverseD;
})(PathsUtils || (PathsUtils = {}));
var InvalidRect64 = Rect64Utils.createInvalid();
var InvalidRectD = RectDUtils.createInvalid();

// pkg/package/src/Engine.ts
var VertexFlags = /* @__PURE__ */ ((VertexFlags2) => {
  VertexFlags2[VertexFlags2["None"] = 0] = "None";
  VertexFlags2[VertexFlags2["OpenStart"] = 1] = "OpenStart";
  VertexFlags2[VertexFlags2["OpenEnd"] = 2] = "OpenEnd";
  VertexFlags2[VertexFlags2["LocalMax"] = 4] = "LocalMax";
  VertexFlags2[VertexFlags2["LocalMin"] = 8] = "LocalMin";
  return VertexFlags2;
})(VertexFlags || {});
var ScanlineHeap = class {
  data = [];
  push(value) {
    this.data.push(value);
    this.siftUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return null;
    const max = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return max;
  }
  clear() {
    this.data.length = 0;
  }
  siftUp(index) {
    while (index > 0) {
      const parent = index - 1 >> 1;
      if (this.data[parent] >= this.data[index]) break;
      [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
      index = parent;
    }
  }
  siftDown(index) {
    const length = this.data.length;
    while (true) {
      let largest = index;
      const left = (index << 1) + 1;
      const right = left + 1;
      if (left < length && this.data[left] > this.data[largest]) largest = left;
      if (right < length && this.data[right] > this.data[largest]) largest = right;
      if (largest === index) break;
      [this.data[index], this.data[largest]] = [this.data[largest], this.data[index]];
      index = largest;
    }
  }
};
var Vertex = class {
  pt;
  next = null;
  prev = null;
  flags;
  constructor(pt, flags, prev) {
    this.pt = pt;
    this.flags = flags;
    this.prev = prev;
  }
};
var LocalMinima = class {
  vertex;
  polytype;
  isOpen;
  constructor(vertex, polytype, isOpen = false) {
    this.vertex = vertex;
    this.polytype = polytype;
    this.isOpen = isOpen;
  }
  equals(other) {
    return other !== null && this.vertex === other.vertex;
  }
};
function createLocalMinima(vertex, polytype, isOpen = false) {
  return new LocalMinima(vertex, polytype, isOpen);
}
function createIntersectNode(pt, edge1, edge2) {
  return { pt: { x: pt.x, y: pt.y }, edge1, edge2 };
}
var OutPt = class _OutPt {
  static _nextId = 1;
  _debugId;
  pt;
  next;
  prev;
  outrec;
  horz;
  constructor(pt, outrec) {
    this._debugId = _OutPt._nextId++;
    this.pt = pt;
    this.outrec = outrec;
    this.next = this;
    this.prev = this;
    this.horz = null;
  }
};
var JoinWith = /* @__PURE__ */ ((JoinWith2) => {
  JoinWith2[JoinWith2["None"] = 0] = "None";
  JoinWith2[JoinWith2["Left"] = 1] = "Left";
  JoinWith2[JoinWith2["Right"] = 2] = "Right";
  return JoinWith2;
})(JoinWith || {});
var HorzPosition = /* @__PURE__ */ ((HorzPosition2) => {
  HorzPosition2[HorzPosition2["Bottom"] = 0] = "Bottom";
  HorzPosition2[HorzPosition2["Middle"] = 1] = "Middle";
  HorzPosition2[HorzPosition2["Top"] = 2] = "Top";
  return HorzPosition2;
})(HorzPosition || {});
var OutRec = class _OutRec {
  static _nextId = 1;
  _debugId;
  idx = 0;
  owner = null;
  frontEdge = null;
  backEdge = null;
  pts = null;
  polypath = null;
  bounds = { left: 0, top: 0, right: 0, bottom: 0 };
  path = [];
  isOpen = false;
  splits = null;
  recursiveSplit = null;
  constructor() {
    this._debugId = _OutRec._nextId++;
  }
};
var HorzSegment = class {
  leftOp;
  rightOp;
  leftToRight;
  constructor(op) {
    this.leftOp = op;
    this.rightOp = null;
    this.leftToRight = true;
  }
};
var HorzJoin = class {
  op1;
  op2;
  constructor(ltor, rtol) {
    this.op1 = ltor;
    this.op2 = rtol;
  }
};
var Active = class {
  bot = { x: 0, y: 0 };
  top = { x: 0, y: 0 };
  curX = 0;
  // current (updated at every new scanline) - keep as number but ensure integer precision
  dx = 0;
  windDx = 0;
  // 1 or -1 depending on winding direction
  windCount = 0;
  windCount2 = 0;
  // winding count of the opposite polytype
  outrec = null;
  // AEL: 'active edge list' (Vatti's AET - active edge table)
  //     a linked list of all edges (from left to right) that are present
  //     (or 'active') within the current scanbeam (a horizontal 'beam' that
  //     sweeps from bottom to top over the paths in the clipping operation).
  prevInAEL = null;
  nextInAEL = null;
  // SEL: 'sorted edge list' (Vatti's ST - sorted table)
  //     linked list used when sorting edges into their new positions at the
  //     top of scanbeams, but also (re)used to process horizontals.
  prevInSEL = null;
  nextInSEL = null;
  jump = null;
  vertexTop = null;
  localMin = null;
  // the bottom of an edge 'bound' (also Vatti)
  isLeftBound = false;
  joinWith = 0 /* None */;
};
var ClipperEngine;
((ClipperEngine2) => {
  function addLocMin(vert, polytype, isOpen, minimaList) {
    if ((vert.flags & 8 /* LocalMin */) !== 0 /* None */) return;
    vert.flags |= 8 /* LocalMin */;
    const lm = new LocalMinima(vert, polytype, isOpen);
    minimaList.push(lm);
  }
  ClipperEngine2.addLocMin = addLocMin;
  function addPathsToVertexList(paths, polytype, isOpen, minimaList, vertexList) {
    for (const path of paths) {
      let v0 = null;
      let prevV = null;
      for (const pt of path) {
        if (v0 === null) {
          v0 = new Vertex(pt, 0 /* None */, null);
          vertexList.push(v0);
          prevV = v0;
        } else if (!(prevV.pt.x === pt.x && prevV.pt.y === pt.y)) {
          const currV2 = new Vertex(pt, 0 /* None */, prevV);
          vertexList.push(currV2);
          prevV.next = currV2;
          prevV = currV2;
        }
      }
      if (prevV?.prev === null) continue;
      if (!isOpen && prevV.pt.x === v0.pt.x && prevV.pt.y === v0.pt.y) prevV = prevV.prev;
      prevV.next = v0;
      v0.prev = prevV;
      if (!isOpen && prevV.next === prevV) continue;
      let goingUp;
      if (isOpen) {
        let currV2 = v0.next;
        while (currV2 !== v0 && currV2.pt.y === v0.pt.y)
          currV2 = currV2.next;
        goingUp = currV2.pt.y <= v0.pt.y;
        if (goingUp) {
          v0.flags = 1 /* OpenStart */;
          addLocMin(v0, polytype, true, minimaList);
        } else {
          v0.flags = 1 /* OpenStart */ | 4 /* LocalMax */;
        }
      } else {
        prevV = v0.prev;
        while (prevV !== v0 && prevV.pt.y === v0.pt.y)
          prevV = prevV.prev;
        if (prevV === v0)
          continue;
        goingUp = prevV.pt.y > v0.pt.y;
      }
      const goingUp0 = goingUp;
      prevV = v0;
      let currV = v0.next;
      while (currV !== v0) {
        if (currV.pt.y > prevV.pt.y && goingUp) {
          prevV.flags |= 4 /* LocalMax */;
          goingUp = false;
        } else if (currV.pt.y < prevV.pt.y && !goingUp) {
          goingUp = true;
          addLocMin(prevV, polytype, isOpen, minimaList);
        }
        prevV = currV;
        currV = currV.next;
      }
      if (isOpen) {
        prevV.flags |= 2 /* OpenEnd */;
        if (goingUp)
          prevV.flags |= 4 /* LocalMax */;
        else
          addLocMin(prevV, polytype, isOpen, minimaList);
      } else if (goingUp !== goingUp0) {
        if (goingUp0) addLocMin(prevV, polytype, false, minimaList);
        else prevV.flags |= 4 /* LocalMax */;
      }
    }
  }
  ClipperEngine2.addPathsToVertexList = addPathsToVertexList;
})(ClipperEngine || (ClipperEngine = {}));
var ReuseableDataContainer64 = class {
  minimaList;
  vertexList;
  constructor() {
    this.minimaList = [];
    this.vertexList = [];
  }
  clear() {
    this.minimaList.length = 0;
    this.vertexList.length = 0;
  }
  addPaths(paths, pt, isOpen) {
    ClipperEngine.addPathsToVertexList(paths, pt, isOpen, this.minimaList, this.vertexList);
  }
};
var PolyPathBase = class {
  parent;
  children = [];
  constructor(parent = null) {
    this.parent = parent;
  }
  get isHole() {
    return this.getIsHole();
  }
  getLevel() {
    let result = 0;
    let pp = this.parent;
    while (pp !== null) {
      ++result;
      pp = pp.parent;
    }
    return result;
  }
  get level() {
    return this.getLevel();
  }
  getIsHole() {
    const lvl = this.getLevel();
    return lvl !== 0 && (lvl & 1) === 0;
  }
  get count() {
    return this.children.length;
  }
  clear() {
    this.children.length = 0;
  }
  toStringInternal(idx, level) {
    let result = "";
    const padding = "  ".repeat(level);
    const plural = this.children.length === 1 ? "" : "s";
    if ((level & 1) === 0) {
      result += `${padding}+- hole (${idx}) contains ${this.children.length} nested polygon${plural}.
`;
    } else {
      result += `${padding}+- polygon (${idx}) contains ${this.children.length} hole${plural}.
`;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.children[i].count > 0) {
        result += this.children[i].toStringInternal(i, level + 1);
      }
    }
    return result;
  }
  toString() {
    if (this.level > 0) return "";
    const plural = this.children.length === 1 ? "" : "s";
    let result = `Polytree with ${this.children.length} polygon${plural}.
`;
    for (let i = 0; i < this.count; i++) {
      if (this.children[i].count > 0) {
        result += this.children[i].toStringInternal(i, 1);
      }
    }
    return result + "\n";
  }
};
var PolyPath64 = class _PolyPath64 extends PolyPathBase {
  polygon = null;
  // polytree root's polygon == null
  constructor(parent = null) {
    super(parent);
  }
  get poly() {
    return this.polygon;
  }
  addChild(p) {
    const newChild = new _PolyPath64(this);
    newChild.polygon = p;
    this.children.push(newChild);
    return newChild;
  }
  child(index) {
    if (index < 0 || index >= this.children.length) {
      throw new Error("Index out of range");
    }
    return this.children[index];
  }
  area() {
    let result = this.polygon === null ? 0 : Clipper.area(this.polygon);
    for (const child of this.children) {
      result += child.area();
    }
    return result;
  }
};
var PolyPathD = class _PolyPathD extends PolyPathBase {
  scale = 1;
  polygon = null;
  constructor(parent = null) {
    super(parent);
  }
  get poly() {
    return this.polygon;
  }
  addChild(p) {
    const newChild = new _PolyPathD(this);
    newChild.scale = this.scale;
    newChild.polygon = Clipper.scalePathD(p, 1 / this.scale);
    this.children.push(newChild);
    return newChild;
  }
  addChildD(p) {
    const newChild = new _PolyPathD(this);
    newChild.scale = this.scale;
    newChild.polygon = p;
    this.children.push(newChild);
    return newChild;
  }
  child(index) {
    if (index < 0 || index >= this.children.length) {
      throw new Error("Index out of range");
    }
    return this.children[index];
  }
  area() {
    let result = this.polygon === null ? 0 : Clipper.areaD(this.polygon);
    for (const child of this.children) {
      result += child.area();
    }
    return result;
  }
};
var PolyTree64 = class extends PolyPath64 {
};
var PolyTreeD = class extends PolyPathD {
  get scaleValue() {
    return this.scale;
  }
};
var ClipperBase = class _ClipperBase {
  cliptype = 0 /* NoClip */;
  fillrule = 0 /* EvenOdd */;
  actives = null;
  sel = null;
  minimaList = [];
  intersectList = [];
  vertexList = [];
  outrecList = [];
  scanlineHeap = new ScanlineHeap();
  scanlineSet = /* @__PURE__ */ new Set();
  horzSegList = [];
  horzJoinList = [];
  currentLocMin = 0;
  currentBotY = 0;
  isSortedMinimaList = false;
  hasOpenPaths = false;
  usingPolytree = false;
  succeeded = false;
  preserveCollinear = true;
  reverseSolution = false;
  constructor() {
  }
  // Helper functions
  static isOdd(val) {
    return (val & 1) !== 0;
  }
  static isHotEdge(ae) {
    return ae.outrec != null;
  }
  static isOpen(ae) {
    return ae.localMin.isOpen;
  }
  static isOpenEnd(ae) {
    return ae.localMin.isOpen && _ClipperBase.isOpenEndVertex(ae.vertexTop);
  }
  static isOpenEndVertex(v) {
    return (v.flags & (1 /* OpenStart */ | 2 /* OpenEnd */)) !== 0 /* None */;
  }
  static getPrevHotEdge(ae) {
    let prev = ae.prevInAEL;
    while (prev !== null && (_ClipperBase.isOpen(prev) || !_ClipperBase.isHotEdge(prev))) {
      prev = prev.prevInAEL;
    }
    return prev;
  }
  static isFront(ae) {
    return ae === ae.outrec.frontEdge;
  }
  /*******************************************************************************
  *  Dx:                             0(90deg)                                    *
  *                                  |                                           *
  *               +inf (180deg) <--- o ---> -inf (0deg)                          *
  *******************************************************************************/
  static getDx(pt1, pt2) {
    const dy = pt2.y - pt1.y;
    if (dy !== 0) {
      return (pt2.x - pt1.x) / dy;
    }
    return pt2.x > pt1.x ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  static topX(ae, currentY) {
    if (currentY === ae.top.y || ae.top.x === ae.bot.x) return ae.top.x;
    if (currentY === ae.bot.y) return ae.bot.x;
    return InternalClipper.roundToEven(ae.bot.x + ae.dx * (currentY - ae.bot.y));
  }
  static isHorizontal(ae) {
    return ae.top.y === ae.bot.y;
  }
  static isHeadingRightHorz(ae) {
    return ae.dx === Number.NEGATIVE_INFINITY;
  }
  static isHeadingLeftHorz(ae) {
    return ae.dx === Number.POSITIVE_INFINITY;
  }
  static swapActives(ae1, ae2) {
    return [ae2, ae1];
  }
  static getPolyType(ae) {
    return ae.localMin.polytype;
  }
  static isSamePolyType(ae1, ae2) {
    return ae1.localMin.polytype === ae2.localMin.polytype;
  }
  static setDx(ae) {
    ae.dx = _ClipperBase.getDx(ae.bot, ae.top);
  }
  static nextVertex(ae) {
    return ae.windDx > 0 ? ae.vertexTop.next : ae.vertexTop.prev;
  }
  static prevPrevVertex(ae) {
    return ae.windDx > 0 ? ae.vertexTop.prev.prev : ae.vertexTop.next.next;
  }
  static isMaxima(vertexOrAe) {
    if ("flags" in vertexOrAe) {
      return (vertexOrAe.flags & 4 /* LocalMax */) !== 0 /* None */;
    } else {
      return _ClipperBase.isMaxima(vertexOrAe.vertexTop);
    }
  }
  static getMaximaPair(ae) {
    let ae2 = ae.nextInAEL;
    while (ae2 !== null) {
      if (ae2.vertexTop === ae.vertexTop) return ae2;
      ae2 = ae2.nextInAEL;
    }
    return null;
  }
  // optimization (not in C# reference): fast bounding box overlap check for segment intersection
  boundingBoxesOverlap(p1, p2, p3, p4) {
    const min1x = Math.min(p1.x, p2.x);
    const max1x = Math.max(p1.x, p2.x);
    const min1y = Math.min(p1.y, p2.y);
    const max1y = Math.max(p1.y, p2.y);
    const min2x = Math.min(p3.x, p4.x);
    const max2x = Math.max(p3.x, p4.x);
    const min2y = Math.min(p3.y, p4.y);
    const max2y = Math.max(p3.y, p4.y);
    return !(max1x < min2x || max2x < min1x || max1y < min2y || max2y < min1y);
  }
  clearSolutionOnly() {
    while (this.actives !== null) this.deleteFromAEL(this.actives);
    this.scanlineHeap.clear();
    this.scanlineSet.clear();
    this.disposeIntersectNodes();
    this.outrecList.length = 0;
    this.horzSegList.length = 0;
    this.horzJoinList.length = 0;
  }
  clear() {
    this.clearSolutionOnly();
    this.minimaList.length = 0;
    this.vertexList.length = 0;
    this.currentLocMin = 0;
    this.isSortedMinimaList = false;
    this.hasOpenPaths = false;
  }
  reset() {
    if (!this.isSortedMinimaList) {
      this.minimaList.sort((a, b) => b.vertex.pt.y - a.vertex.pt.y);
      this.isSortedMinimaList = true;
    }
    this.scanlineHeap.clear();
    this.scanlineSet.clear();
    for (let i = this.minimaList.length - 1; i >= 0; i--) {
      this.insertScanline(this.minimaList[i].vertex.pt.y);
    }
    this.currentBotY = 0;
    this.currentLocMin = 0;
    this.actives = null;
    this.sel = null;
    this.succeeded = true;
  }
  insertScanline(y) {
    if (this.scanlineSet.has(y)) return;
    this.scanlineSet.add(y);
    this.scanlineHeap.push(y);
  }
  popScanline() {
    const y = this.scanlineHeap.pop();
    if (y === null) return { success: false, y: 0 };
    this.scanlineSet.delete(y);
    return { success: true, y };
  }
  hasLocMinAtY(y) {
    return this.currentLocMin < this.minimaList.length && this.minimaList[this.currentLocMin].vertex.pt.y === y;
  }
  popLocalMinima() {
    return this.minimaList[this.currentLocMin++];
  }
  addPath(path, polytype, isOpen = false) {
    const tmp = [path];
    this.addPaths(tmp, polytype, isOpen);
  }
  addPaths(paths, polytype, isOpen = false) {
    if (isOpen) this.hasOpenPaths = true;
    this.isSortedMinimaList = false;
    ClipperEngine.addPathsToVertexList(paths, polytype, isOpen, this.minimaList, this.vertexList);
  }
  addReuseableData(reuseableData) {
    if (reuseableData["minimaList"].length === 0) return;
    this.isSortedMinimaList = false;
    for (const lm of reuseableData["minimaList"]) {
      this.minimaList.push(new LocalMinima(lm.vertex, lm.polytype, lm.isOpen));
      if (lm.isOpen) this.hasOpenPaths = true;
    }
  }
  deleteFromAEL(ae) {
    const prev = ae.prevInAEL;
    const next = ae.nextInAEL;
    if (prev === null && next === null && ae !== this.actives) return;
    if (prev !== null) {
      prev.nextInAEL = next;
    } else {
      this.actives = next;
    }
    if (next !== null) next.prevInAEL = prev;
  }
  getBounds() {
    const bounds = {
      left: Number.MAX_SAFE_INTEGER,
      top: Number.MAX_SAFE_INTEGER,
      right: Number.MIN_SAFE_INTEGER,
      bottom: Number.MIN_SAFE_INTEGER
    };
    for (const t of this.vertexList) {
      let v = t;
      do {
        if (v.pt.x < bounds.left) bounds.left = v.pt.x;
        if (v.pt.x > bounds.right) bounds.right = v.pt.x;
        if (v.pt.y < bounds.top) bounds.top = v.pt.y;
        if (v.pt.y > bounds.bottom) bounds.bottom = v.pt.y;
        v = v.next;
      } while (v !== t);
    }
    return Rect64Utils.isEmpty(bounds) ? { left: 0, top: 0, right: 0, bottom: 0 } : bounds;
  }
  executeInternal(ct, fillRule) {
    if (ct === 0 /* NoClip */) return;
    this.fillrule = fillRule;
    this.cliptype = ct;
    this.reset();
    const scanResult = this.popScanline();
    if (!scanResult.success) return;
    let y = scanResult.y;
    while (this.succeeded) {
      this.insertLocalMinimaIntoAEL(y);
      let ae;
      while ((ae = this.popHorz()) !== null) this.doHorizontal(ae);
      if (this.horzSegList.length > 0) {
        this.convertHorzSegsToJoins();
        this.horzSegList.length = 0;
      }
      this.currentBotY = y;
      const nextScanResult = this.popScanline();
      if (!nextScanResult.success) break;
      y = nextScanResult.y;
      this.doIntersections(y);
      this.doTopOfScanbeam(y);
      while ((ae = this.popHorz()) !== null) this.doHorizontal(ae);
    }
    if (this.succeeded) this.processHorzJoins();
  }
  insertLocalMinimaIntoAEL(botY) {
    while (this.hasLocMinAtY(botY)) {
      const localMinima = this.popLocalMinima();
      let leftBound;
      if ((localMinima.vertex.flags & 1 /* OpenStart */) !== 0 /* None */) {
        leftBound = null;
      } else {
        leftBound = new Active();
        leftBound.bot = { x: localMinima.vertex.pt.x, y: localMinima.vertex.pt.y };
        leftBound.curX = localMinima.vertex.pt.x;
        leftBound.windDx = -1;
        leftBound.vertexTop = localMinima.vertex.prev;
        leftBound.top = { x: localMinima.vertex.prev.pt.x, y: localMinima.vertex.prev.pt.y };
        leftBound.outrec = null;
        leftBound.localMin = localMinima;
        _ClipperBase.setDx(leftBound);
      }
      let rightBound;
      if ((localMinima.vertex.flags & 2 /* OpenEnd */) !== 0 /* None */) {
        rightBound = null;
      } else {
        rightBound = new Active();
        rightBound.bot = { x: localMinima.vertex.pt.x, y: localMinima.vertex.pt.y };
        rightBound.curX = localMinima.vertex.pt.x;
        rightBound.windDx = 1;
        rightBound.vertexTop = localMinima.vertex.next;
        rightBound.top = { x: localMinima.vertex.next.pt.x, y: localMinima.vertex.next.pt.y };
        rightBound.outrec = null;
        rightBound.localMin = localMinima;
        _ClipperBase.setDx(rightBound);
      }
      if (leftBound !== null && rightBound !== null) {
        if (_ClipperBase.isHorizontal(leftBound)) {
          if (_ClipperBase.isHeadingRightHorz(leftBound)) [leftBound, rightBound] = _ClipperBase.swapActives(leftBound, rightBound);
        } else if (_ClipperBase.isHorizontal(rightBound)) {
          if (_ClipperBase.isHeadingLeftHorz(rightBound)) [leftBound, rightBound] = _ClipperBase.swapActives(leftBound, rightBound);
        } else if (leftBound.dx < rightBound.dx) {
          [leftBound, rightBound] = _ClipperBase.swapActives(leftBound, rightBound);
        }
      } else if (leftBound === null) {
        leftBound = rightBound;
        rightBound = null;
      }
      let contributing;
      leftBound.isLeftBound = true;
      this.insertLeftEdge(leftBound);
      if (_ClipperBase.isOpen(leftBound)) {
        this.setWindCountForOpenPathEdge(leftBound);
        contributing = this.isContributingOpen(leftBound);
      } else {
        this.setWindCountForClosedPathEdge(leftBound);
        contributing = this.isContributingClosed(leftBound);
      }
      if (rightBound !== null) {
        rightBound.windCount = leftBound.windCount;
        rightBound.windCount2 = leftBound.windCount2;
        this.insertRightEdge(leftBound, rightBound);
        if (contributing) {
          this.addLocalMinPoly(leftBound, rightBound, leftBound.bot, true);
          if (!_ClipperBase.isHorizontal(leftBound)) {
            this.checkJoinLeft(leftBound, leftBound.bot);
          }
        }
        while (rightBound.nextInAEL !== null && this.isValidAelOrder(rightBound.nextInAEL, rightBound)) {
          this.intersectEdges(rightBound, rightBound.nextInAEL, rightBound.bot);
          this.swapPositionsInAEL(rightBound, rightBound.nextInAEL);
        }
        if (_ClipperBase.isHorizontal(rightBound)) {
          this.pushHorz(rightBound);
        } else {
          this.checkJoinRight(rightBound, rightBound.bot);
          this.insertScanline(rightBound.top.y);
        }
      } else if (contributing) {
        this.startOpenPath(leftBound, leftBound.bot);
      }
      if (_ClipperBase.isHorizontal(leftBound)) {
        this.pushHorz(leftBound);
      } else {
        this.insertScanline(leftBound.top.y);
      }
    }
  }
  pushHorz(ae) {
    ae.nextInSEL = this.sel;
    this.sel = ae;
  }
  popHorz() {
    const ae = this.sel;
    if (ae === null) return null;
    this.sel = this.sel.nextInSEL;
    return ae;
  }
  doHorizontal(horz) {
    const horzIsOpen = _ClipperBase.isOpen(horz);
    const y = horz.bot.y;
    const vertexMax = horzIsOpen ? this.getCurrYMaximaVertexOpen(horz) : this.getCurrYMaximaVertex(horz);
    const { isLeftToRight, leftX, rightX } = this.resetHorzDirection(horz, vertexMax);
    let leftX2 = leftX;
    let rightX2 = rightX;
    if (_ClipperBase.isHotEdge(horz)) {
      const op = this.addOutPt(horz, { x: horz.curX, y });
      this.addToHorzSegList(op);
    }
    while (true) {
      let ae = isLeftToRight ? horz.nextInAEL : horz.prevInAEL;
      while (ae !== null) {
        if (ae.vertexTop === vertexMax) {
          if (_ClipperBase.isHotEdge(horz) && this.isJoined(ae)) this.split(ae, ae.top);
          if (_ClipperBase.isHotEdge(horz)) {
            while (horz.vertexTop !== vertexMax) {
              this.addOutPt(horz, horz.top);
              this.updateEdgeIntoAEL(horz);
            }
            if (isLeftToRight) {
              this.addLocalMaxPoly(horz, ae, horz.top);
            } else {
              this.addLocalMaxPoly(ae, horz, horz.top);
            }
          }
          this.deleteFromAEL(ae);
          this.deleteFromAEL(horz);
          return;
        }
        if (vertexMax !== horz.vertexTop || _ClipperBase.isOpenEnd(horz)) {
          if (isLeftToRight && ae.curX > rightX2 || !isLeftToRight && ae.curX < leftX2) break;
          if (ae.curX === horz.top.x && !_ClipperBase.isHorizontal(ae)) {
            const pt2 = _ClipperBase.nextVertex(horz).pt;
            if (_ClipperBase.isOpen(ae) && !_ClipperBase.isSamePolyType(ae, horz) && !_ClipperBase.isHotEdge(ae)) {
              if (isLeftToRight && _ClipperBase.topX(ae, pt2.y) > pt2.x || !isLeftToRight && _ClipperBase.topX(ae, pt2.y) < pt2.x) break;
            } else if (isLeftToRight && _ClipperBase.topX(ae, pt2.y) >= pt2.x || !isLeftToRight && _ClipperBase.topX(ae, pt2.y) <= pt2.x) break;
          }
        }
        const pt = { x: ae.curX, y };
        if (isLeftToRight) {
          this.intersectEdges(horz, ae, pt);
          this.swapPositionsInAEL(horz, ae);
          this.checkJoinLeft(ae, pt);
          horz.curX = ae.curX;
          ae = horz.nextInAEL;
        } else {
          this.intersectEdges(ae, horz, pt);
          this.swapPositionsInAEL(ae, horz);
          this.checkJoinRight(ae, pt);
          horz.curX = ae.curX;
          ae = horz.prevInAEL;
        }
        if (_ClipperBase.isHotEdge(horz)) {
          this.addToHorzSegList(this.getLastOp(horz));
        }
      }
      if (horzIsOpen && _ClipperBase.isOpenEnd(horz)) {
        if (_ClipperBase.isHotEdge(horz)) {
          this.addOutPt(horz, horz.top);
          if (_ClipperBase.isFront(horz)) {
            horz.outrec.frontEdge = null;
          } else {
            horz.outrec.backEdge = null;
          }
          horz.outrec = null;
        }
        this.deleteFromAEL(horz);
        return;
      }
      if (_ClipperBase.nextVertex(horz).pt.y !== horz.top.y) {
        break;
      }
      if (_ClipperBase.isHotEdge(horz)) {
        this.addOutPt(horz, horz.top);
      }
      this.updateEdgeIntoAEL(horz);
      const resetResult = this.resetHorzDirection(horz, vertexMax);
      leftX2 = resetResult.leftX;
      rightX2 = resetResult.rightX;
    }
    if (_ClipperBase.isHotEdge(horz)) {
      const op = this.addOutPt(horz, horz.top);
      this.addToHorzSegList(op);
    }
    this.updateEdgeIntoAEL(horz);
  }
  convertHorzSegsToJoins() {
    let k = 0;
    for (const hs of this.horzSegList) {
      if (this.updateHorzSegment(hs)) k++;
    }
    if (k < 2) return;
    this.horzSegList.sort((a, b) => this.horzSegSort(a, b));
    for (let i = 0; i < k - 1; i++) {
      const hs1 = this.horzSegList[i];
      for (let j = i + 1; j < k; j++) {
        const hs2 = this.horzSegList[j];
        if (hs2.leftOp.pt.x >= hs1.rightOp.pt.x || hs2.leftToRight === hs1.leftToRight || hs2.rightOp.pt.x <= hs1.leftOp.pt.x) continue;
        const currY = hs1.leftOp.pt.y;
        if (hs1.leftToRight) {
          while (hs1.leftOp.next.pt.y === currY && hs1.leftOp.next.pt.x <= hs2.leftOp.pt.x)
            hs1.leftOp = hs1.leftOp.next;
          while (hs2.leftOp.prev.pt.y === currY && hs2.leftOp.prev.pt.x <= hs1.leftOp.pt.x)
            hs2.leftOp = hs2.leftOp.prev;
          const join = new HorzJoin(
            this.duplicateOp(hs1.leftOp, true),
            this.duplicateOp(hs2.leftOp, false)
          );
          this.horzJoinList.push(join);
        } else {
          while (hs1.leftOp.prev.pt.y === currY && hs1.leftOp.prev.pt.x <= hs2.leftOp.pt.x)
            hs1.leftOp = hs1.leftOp.prev;
          while (hs2.leftOp.next.pt.y === currY && hs2.leftOp.next.pt.x <= hs1.leftOp.pt.x)
            hs2.leftOp = hs2.leftOp.next;
          const join = new HorzJoin(
            this.duplicateOp(hs2.leftOp, true),
            this.duplicateOp(hs1.leftOp, false)
          );
          this.horzJoinList.push(join);
        }
      }
    }
  }
  updateHorzSegment(hs) {
    const op = hs.leftOp;
    const outrec = this.getRealOutRec(op.outrec);
    const outrecHasEdges = outrec.frontEdge !== null;
    const currY = op.pt.y;
    let opP = op;
    let opN = op;
    if (outrecHasEdges) {
      const opA = outrec.pts;
      const opZ = opA.next;
      while (opP !== opZ && opP.prev.pt.y === currY)
        opP = opP.prev;
      while (opN !== opA && opN.next.pt.y === currY)
        opN = opN.next;
    } else {
      while (opP.prev !== opN && opP.prev.pt.y === currY)
        opP = opP.prev;
      while (opN.next !== opP && opN.next.pt.y === currY)
        opN = opN.next;
    }
    const result = this.setHorzSegHeadingForward(hs, opP, opN) && hs.leftOp.horz === null;
    if (result) {
      hs.leftOp.horz = hs;
    } else {
      hs.rightOp = null;
    }
    return result;
  }
  setHorzSegHeadingForward(hs, opP, opN) {
    if (opP.pt.x === opN.pt.x) return false;
    if (opP.pt.x < opN.pt.x) {
      hs.leftOp = opP;
      hs.rightOp = opN;
      hs.leftToRight = true;
    } else {
      hs.leftOp = opN;
      hs.rightOp = opP;
      hs.leftToRight = false;
    }
    return true;
  }
  horzSegSort(hs1, hs2) {
    if (hs1.rightOp === null) {
      return hs2.rightOp === null ? 0 : 1;
    }
    if (hs2.rightOp === null) return -1;
    return hs1.leftOp.pt.x - hs2.leftOp.pt.x;
  }
  duplicateOp(op, insertAfter) {
    const result = new OutPt(op.pt, op.outrec);
    if (insertAfter) {
      result.next = op.next;
      result.next.prev = result;
      result.prev = op;
      op.next = result;
    } else {
      result.prev = op.prev;
      result.prev.next = result;
      result.next = op;
      op.prev = result;
    }
    return result;
  }
  getRealOutRec(outRec) {
    while (outRec !== null && outRec.pts === null) {
      outRec = outRec.owner;
    }
    return outRec;
  }
  doIntersections(y) {
    if (this.buildIntersectList(y)) {
      this.processIntersectList();
      this.disposeIntersectNodes();
    }
  }
  doTopOfScanbeam(y) {
    this.sel = null;
    let ae = this.actives;
    while (ae !== null) {
      if (ae.top.y === y) {
        ae.curX = ae.top.x;
        if (_ClipperBase.isMaxima(ae)) {
          ae = this.doMaxima(ae);
          continue;
        } else {
          if (_ClipperBase.isHotEdge(ae)) this.addOutPt(ae, ae.top);
          this.updateEdgeIntoAEL(ae);
          if (_ClipperBase.isHorizontal(ae)) {
            this.pushHorz(ae);
          }
        }
      } else {
        ae.curX = _ClipperBase.topX(ae, y);
      }
      ae = ae.nextInAEL;
    }
  }
  processHorzJoins() {
    for (const j of this.horzJoinList) {
      const or1 = this.getRealOutRec(j.op1.outrec);
      const or2 = this.getRealOutRec(j.op2.outrec);
      const op1b = j.op1.next;
      const op2b = j.op2.prev;
      j.op1.next = j.op2;
      j.op2.prev = j.op1;
      op1b.prev = op2b;
      op2b.next = op1b;
      if (or1 === or2) {
        const or2New = this.newOutRec();
        or2New.pts = op1b;
        this.fixOutRecPts(or2New);
        if (or1.pts.outrec === or2New) {
          or1.pts = j.op1;
          or1.pts.outrec = or1;
        }
        if (this.usingPolytree) {
          if (this.path1InsidePath2(or1.pts, or2New.pts)) {
            [or2New.pts, or1.pts] = [or1.pts, or2New.pts];
            this.fixOutRecPts(or1);
            this.fixOutRecPts(or2New);
            or2New.owner = or1;
          } else if (this.path1InsidePath2(or2New.pts, or1.pts)) {
            or2New.owner = or1;
          } else {
            or2New.owner = or1.owner;
          }
          if (or1.splits === null) or1.splits = [];
          or1.splits.push(or2New.idx);
        } else {
          or2New.owner = or1;
        }
      } else {
        or2.pts = null;
        if (this.usingPolytree) {
          this.setOwner(or2, or1);
          this.moveSplits(or2, or1);
        } else {
          or2.owner = or1;
        }
      }
    }
  }
  fixOutRecPts(outrec) {
    let op = outrec.pts;
    do {
      op.outrec = outrec;
      op = op.next;
    } while (op !== outrec.pts);
  }
  path1InsidePath2(op1, op2) {
    let pip = 0 /* IsOn */;
    let op = op1;
    do {
      switch (this.pointInOpPolygon(op.pt, op2)) {
        case 2 /* IsOutside */:
          if (pip === 2 /* IsOutside */) return false;
          pip = 2 /* IsOutside */;
          break;
        case 1 /* IsInside */:
          if (pip === 1 /* IsInside */) return true;
          pip = 1 /* IsInside */;
          break;
        default:
          break;
      }
      op = op.next;
    } while (op !== op1);
    return InternalClipper.path2ContainsPath1(this.getCleanPath(op1), this.getCleanPath(op2));
  }
  pointInOpPolygon(pt, op) {
    if (op === op.next || op.prev === op.next) {
      return 2 /* IsOutside */;
    }
    let op2 = op;
    do {
      if (op.pt.y !== pt.y) break;
      op = op.next;
    } while (op !== op2);
    if (op.pt.y === pt.y)
      return 2 /* IsOutside */;
    let isAbove = op.pt.y < pt.y;
    const startingAbove = isAbove;
    let val = 0;
    op2 = op.next;
    while (op2 !== op) {
      if (isAbove) {
        while (op2 !== op && op2.pt.y < pt.y) op2 = op2.next;
      } else {
        while (op2 !== op && op2.pt.y > pt.y) op2 = op2.next;
      }
      if (op2 === op) break;
      if (op2.pt.y === pt.y) {
        if (op2.pt.x === pt.x || op2.pt.y === op2.prev.pt.y && pt.x < op2.prev.pt.x !== pt.x < op2.pt.x)
          return 0 /* IsOn */;
        op2 = op2.next;
        if (op2 === op) break;
        continue;
      }
      if (op2.pt.x <= pt.x || op2.prev.pt.x <= pt.x) {
        if (op2.prev.pt.x < pt.x && op2.pt.x < pt.x) {
          val = 1 - val;
        } else {
          const d = InternalClipper.crossProduct(op2.prev.pt, op2.pt, pt);
          if (d === 0) return 0 /* IsOn */;
          if (d < 0 === isAbove) val = 1 - val;
        }
      }
      isAbove = !isAbove;
      op2 = op2.next;
    }
    if (isAbove === startingAbove) return val === 0 ? 2 /* IsOutside */ : 1 /* IsInside */;
    {
      const d = InternalClipper.crossProduct(op2.prev.pt, op2.pt, pt);
      if (d === 0) return 0 /* IsOn */;
      if (d < 0 === isAbove) val = 1 - val;
    }
    return val === 0 ? 2 /* IsOutside */ : 1 /* IsInside */;
  }
  getCleanPath(op) {
    const result = [];
    let op2 = op;
    while (op2.next !== op && (op2.pt.x === op2.next.pt.x && op2.pt.x === op2.prev.pt.x || op2.pt.y === op2.next.pt.y && op2.pt.y === op2.prev.pt.y)) op2 = op2.next;
    result.push(op2.pt);
    let prevOp = op2;
    op2 = op2.next;
    while (op2 !== op) {
      if ((op2.pt.x !== op2.next.pt.x || op2.pt.x !== prevOp.pt.x) && (op2.pt.y !== op2.next.pt.y || op2.pt.y !== prevOp.pt.y)) {
        result.push(op2.pt);
        prevOp = op2;
      }
      op2 = op2.next;
    }
    return result;
  }
  moveSplits(fromOr, toOr) {
    if (fromOr.splits === null) return;
    if (toOr.splits === null) toOr.splits = [];
    for (const i of fromOr.splits) {
      if (i !== toOr.idx) {
        toOr.splits.push(i);
      }
    }
    fromOr.splits = null;
  }
  buildIntersectList(topY) {
    if (this.actives?.nextInAEL === null) return false;
    this.adjustCurrXAndCopyToSEL(topY);
    let left = this.sel;
    while (left !== null && left.jump !== null) {
      let prevBase = null;
      while (left !== null && left.jump !== null) {
        let currBase = left;
        let right = left.jump;
        let lEnd = right;
        const rEnd = right?.jump || null;
        left.jump = rEnd;
        while (left !== lEnd && right !== rEnd) {
          if (right.curX < left.curX) {
            let tmp = right.prevInSEL;
            while (true) {
              this.addNewIntersectNode(tmp, right, topY);
              if (tmp === left) break;
              tmp = tmp.prevInSEL;
            }
            tmp = right;
            right = this.extractFromSEL(tmp);
            lEnd = right;
            if (left !== null) this.insert1Before2InSEL(tmp, left);
            if (left !== currBase) continue;
            currBase = tmp;
            currBase.jump = rEnd;
            if (prevBase === null) {
              this.sel = currBase;
            } else {
              prevBase.jump = currBase;
            }
          } else {
            left = left.nextInSEL;
          }
        }
        prevBase = currBase;
        left = rEnd;
      }
      left = this.sel;
    }
    return this.intersectList.length > 0;
  }
  processIntersectList() {
    this.intersectList.sort((a, b) => {
      if (a.pt.y !== b.pt.y) return a.pt.y > b.pt.y ? -1 : 1;
      if (a.pt.x !== b.pt.x) return a.pt.x < b.pt.x ? -1 : 1;
      if (a.edge1.curX !== b.edge1.curX) return a.edge1.curX < b.edge1.curX ? -1 : 1;
      return a.edge2.curX < b.edge2.curX ? -1 : a.edge2.curX > b.edge2.curX ? 1 : 0;
    });
    for (let i = 0; i < this.intersectList.length; ++i) {
      if (!this.edgesAdjacentInAEL(this.intersectList[i])) {
        let j = i + 1;
        while (!this.edgesAdjacentInAEL(this.intersectList[j])) j++;
        [this.intersectList[j], this.intersectList[i]] = [this.intersectList[i], this.intersectList[j]];
      }
      const node = this.intersectList[i];
      this.intersectEdges(node.edge1, node.edge2, node.pt);
      this.swapPositionsInAEL(node.edge1, node.edge2);
      node.edge1.curX = node.pt.x;
      node.edge2.curX = node.pt.x;
      this.checkJoinLeft(node.edge2, node.pt, true);
      this.checkJoinRight(node.edge1, node.pt, true);
    }
  }
  edgesAdjacentInAEL(inode) {
    return inode.edge1.nextInAEL === inode.edge2 || inode.edge1.prevInAEL === inode.edge2;
  }
  adjustCurrXAndCopyToSEL(topY) {
    let ae = this.actives;
    this.sel = ae;
    while (ae !== null) {
      ae.prevInSEL = ae.prevInAEL;
      ae.nextInSEL = ae.nextInAEL;
      ae.jump = ae.nextInSEL;
      ae.curX = _ClipperBase.topX(ae, topY);
      ae = ae.nextInAEL;
    }
  }
  doMaxima(ae) {
    const prevE = ae.prevInAEL;
    let nextE = ae.nextInAEL;
    if (_ClipperBase.isOpenEnd(ae)) {
      if (_ClipperBase.isHotEdge(ae)) this.addOutPt(ae, ae.top);
      if (_ClipperBase.isHorizontal(ae)) return nextE;
      if (_ClipperBase.isHotEdge(ae)) {
        if (_ClipperBase.isFront(ae)) {
          ae.outrec.frontEdge = null;
        } else {
          ae.outrec.backEdge = null;
        }
        ae.outrec = null;
      }
      this.deleteFromAEL(ae);
      return nextE;
    }
    const maxPair = _ClipperBase.getMaximaPair(ae);
    if (maxPair === null) return nextE;
    if (this.isJoined(ae)) this.split(ae, ae.top);
    if (this.isJoined(maxPair)) this.split(maxPair, maxPair.top);
    while (nextE !== maxPair) {
      this.intersectEdges(ae, nextE, ae.top);
      this.swapPositionsInAEL(ae, nextE);
      nextE = ae.nextInAEL;
    }
    if (_ClipperBase.isOpen(ae)) {
      if (_ClipperBase.isHotEdge(ae)) {
        this.addLocalMaxPoly(ae, maxPair, ae.top);
      }
      this.deleteFromAEL(maxPair);
      this.deleteFromAEL(ae);
      return prevE !== null ? prevE.nextInAEL : this.actives;
    }
    if (_ClipperBase.isHotEdge(ae)) {
      this.addLocalMaxPoly(ae, maxPair, ae.top);
    }
    this.deleteFromAEL(ae);
    this.deleteFromAEL(maxPair);
    return prevE !== null ? prevE.nextInAEL : this.actives;
  }
  updateEdgeIntoAEL(ae) {
    ae.bot = { x: ae.top.x, y: ae.top.y };
    ae.vertexTop = _ClipperBase.nextVertex(ae);
    ae.top = { x: ae.vertexTop.pt.x, y: ae.vertexTop.pt.y };
    ae.curX = ae.bot.x;
    _ClipperBase.setDx(ae);
    if (this.isJoined(ae)) this.split(ae, ae.bot);
    if (_ClipperBase.isHorizontal(ae)) {
      if (!_ClipperBase.isOpen(ae)) this.trimHorz(ae, this.preserveCollinear);
      return;
    }
    this.insertScanline(ae.top.y);
    this.checkJoinLeft(ae, ae.bot);
    this.checkJoinRight(ae, ae.bot, true);
  }
  trimHorz(horzEdge, preserveCollinear) {
    let wasTrimmed = false;
    let pt = _ClipperBase.nextVertex(horzEdge).pt;
    while (pt.y === horzEdge.top.y) {
      if (preserveCollinear && pt.x < horzEdge.top.x !== horzEdge.bot.x < horzEdge.top.x) {
        break;
      }
      horzEdge.vertexTop = _ClipperBase.nextVertex(horzEdge);
      horzEdge.top = pt;
      wasTrimmed = true;
      if (_ClipperBase.isMaxima(horzEdge)) break;
      pt = _ClipperBase.nextVertex(horzEdge).pt;
    }
    if (wasTrimmed) _ClipperBase.setDx(horzEdge);
  }
  addToHorzSegList(op) {
    if (op.outrec.isOpen) return;
    this.horzSegList.push(new HorzSegment(op));
  }
  addNewIntersectNode(ae1, ae2, topY) {
    const intersectResult = InternalClipper.getLineIntersectPt(ae1.bot, ae1.top, ae2.bot, ae2.top);
    let ip;
    if (!intersectResult.intersects) {
      ip = { x: ae1.curX, y: topY };
    } else {
      ip = intersectResult.point;
    }
    if (ip.y > this.currentBotY || ip.y < topY) {
      const absDx1 = Math.abs(ae1.dx);
      const absDx2 = Math.abs(ae2.dx);
      if (absDx1 > 100 && absDx2 > 100) {
        if (absDx1 > absDx2) {
          ip = InternalClipper.getClosestPtOnSegment(ip, ae1.bot, ae1.top);
        } else {
          ip = InternalClipper.getClosestPtOnSegment(ip, ae2.bot, ae2.top);
        }
      } else if (absDx1 > 100) {
        ip = InternalClipper.getClosestPtOnSegment(ip, ae1.bot, ae1.top);
      } else if (absDx2 > 100) {
        ip = InternalClipper.getClosestPtOnSegment(ip, ae2.bot, ae2.top);
      } else {
        if (ip.y < topY) ip.y = topY;
        else ip.y = this.currentBotY;
        if (absDx1 < absDx2) ip.x = _ClipperBase.topX(ae1, ip.y);
        else ip.x = _ClipperBase.topX(ae2, ip.y);
      }
    }
    const node = createIntersectNode(ip, ae1, ae2);
    this.intersectList.push(node);
  }
  extractFromSEL(ae) {
    const res = ae.nextInSEL;
    if (res !== null) {
      res.prevInSEL = ae.prevInSEL;
    }
    ae.prevInSEL.nextInSEL = res;
    return res;
  }
  insert1Before2InSEL(ae1, ae2) {
    ae1.prevInSEL = ae2.prevInSEL;
    if (ae1.prevInSEL !== null) {
      ae1.prevInSEL.nextInSEL = ae1;
    }
    ae1.nextInSEL = ae2;
    ae2.prevInSEL = ae1;
  }
  getCurrYMaximaVertexOpen(ae) {
    let result = ae.vertexTop;
    if (ae.windDx > 0) {
      while (result.next.pt.y === result.pt.y && (result.flags & (2 /* OpenEnd */ | 4 /* LocalMax */)) === 0 /* None */)
        result = result.next;
    } else {
      while (result.prev.pt.y === result.pt.y && (result.flags & (2 /* OpenEnd */ | 4 /* LocalMax */)) === 0 /* None */)
        result = result.prev;
    }
    if (!_ClipperBase.isMaxima(result)) result = null;
    return result;
  }
  getCurrYMaximaVertex(ae) {
    let result = ae.vertexTop;
    if (ae.windDx > 0) {
      while (result.next.pt.y === result.pt.y) result = result.next;
    } else {
      while (result.prev.pt.y === result.pt.y) result = result.prev;
    }
    if (!_ClipperBase.isMaxima(result)) result = null;
    return result;
  }
  resetHorzDirection(horz, vertexMax) {
    if (horz.bot.x === horz.top.x) {
      const leftX = horz.curX;
      const rightX = horz.curX;
      let ae = horz.nextInAEL;
      while (ae !== null && ae.vertexTop !== vertexMax)
        ae = ae.nextInAEL;
      return { isLeftToRight: ae !== null, leftX, rightX };
    }
    if (horz.curX < horz.top.x) {
      return { isLeftToRight: true, leftX: horz.curX, rightX: horz.top.x };
    } else {
      return { isLeftToRight: false, leftX: horz.top.x, rightX: horz.curX };
    }
  }
  getLastOp(hotEdge) {
    const outrec = hotEdge.outrec;
    return hotEdge === outrec.frontEdge ? outrec.pts : outrec.pts.next;
  }
  insertLeftEdge(ae) {
    if (this.actives === null) {
      ae.prevInAEL = null;
      ae.nextInAEL = null;
      this.actives = ae;
    } else if (!this.isValidAelOrder(this.actives, ae)) {
      ae.prevInAEL = null;
      ae.nextInAEL = this.actives;
      this.actives.prevInAEL = ae;
      this.actives = ae;
    } else {
      let ae2 = this.actives;
      while (ae2.nextInAEL !== null && this.isValidAelOrder(ae2.nextInAEL, ae)) {
        ae2 = ae2.nextInAEL;
      }
      if (ae2.joinWith === 2 /* Right */) ae2 = ae2.nextInAEL;
      ae.nextInAEL = ae2.nextInAEL;
      if (ae2.nextInAEL !== null) ae2.nextInAEL.prevInAEL = ae;
      ae.prevInAEL = ae2;
      ae2.nextInAEL = ae;
    }
  }
  insertRightEdge(ae1, ae2) {
    ae2.nextInAEL = ae1.nextInAEL;
    if (ae1.nextInAEL !== null) ae1.nextInAEL.prevInAEL = ae2;
    ae2.prevInAEL = ae1;
    ae1.nextInAEL = ae2;
  }
  setWindCountForOpenPathEdge(ae) {
    let ae2 = this.actives;
    if (this.fillrule === 0 /* EvenOdd */) {
      let cnt1 = 0, cnt2 = 0;
      while (ae2 !== ae) {
        if (_ClipperBase.getPolyType(ae2) === 1 /* Clip */) {
          cnt2++;
        } else if (!_ClipperBase.isOpen(ae2)) {
          cnt1++;
        }
        ae2 = ae2.nextInAEL;
      }
      ae.windCount = _ClipperBase.isOdd(cnt1) ? 1 : 0;
      ae.windCount2 = _ClipperBase.isOdd(cnt2) ? 1 : 0;
    } else {
      while (ae2 !== ae) {
        if (_ClipperBase.getPolyType(ae2) === 1 /* Clip */) {
          ae.windCount2 += ae2.windDx;
        } else if (!_ClipperBase.isOpen(ae2)) {
          ae.windCount += ae2.windDx;
        }
        ae2 = ae2.nextInAEL;
      }
    }
  }
  setWindCountForClosedPathEdge(ae) {
    let ae2 = ae.prevInAEL;
    const pt = _ClipperBase.getPolyType(ae);
    while (ae2 !== null && (_ClipperBase.getPolyType(ae2) !== pt || _ClipperBase.isOpen(ae2))) ae2 = ae2.prevInAEL;
    if (ae2 === null) {
      ae.windCount = ae.windDx;
      ae2 = this.actives;
    } else if (this.fillrule === 0 /* EvenOdd */) {
      ae.windCount = ae.windDx;
      ae.windCount2 = ae2.windCount2;
      ae2 = ae2.nextInAEL;
    } else {
      if (ae2.windCount * ae2.windDx < 0) {
        if (Math.abs(ae2.windCount) > 1) {
          if (ae2.windDx * ae.windDx < 0) {
            ae.windCount = ae2.windCount;
          } else {
            ae.windCount = ae2.windCount + ae.windDx;
          }
        } else {
          ae.windCount = _ClipperBase.isOpen(ae) ? 1 : ae.windDx;
        }
      } else {
        if (ae2.windDx * ae.windDx < 0) {
          ae.windCount = ae2.windCount;
        } else {
          ae.windCount = ae2.windCount + ae.windDx;
        }
      }
      ae.windCount2 = ae2.windCount2;
      ae2 = ae2.nextInAEL;
    }
    if (this.fillrule === 0 /* EvenOdd */) {
      while (ae2 !== ae) {
        if (_ClipperBase.getPolyType(ae2) !== pt && !_ClipperBase.isOpen(ae2)) {
          ae.windCount2 = ae.windCount2 === 0 ? 1 : 0;
        }
        ae2 = ae2.nextInAEL;
      }
    } else {
      while (ae2 !== ae) {
        if (_ClipperBase.getPolyType(ae2) !== pt && !_ClipperBase.isOpen(ae2)) {
          ae.windCount2 += ae2.windDx;
        }
        ae2 = ae2.nextInAEL;
      }
    }
  }
  isContributingOpen(ae) {
    let isInClip, isInSubj;
    switch (this.fillrule) {
      case 2 /* Positive */:
        isInSubj = ae.windCount > 0;
        isInClip = ae.windCount2 > 0;
        break;
      case 3 /* Negative */:
        isInSubj = ae.windCount < 0;
        isInClip = ae.windCount2 < 0;
        break;
      default:
        isInSubj = ae.windCount !== 0;
        isInClip = ae.windCount2 !== 0;
        break;
    }
    switch (this.cliptype) {
      case 1 /* Intersection */:
        return isInClip;
      case 2 /* Union */:
        return !isInSubj && !isInClip;
      default:
        return !isInClip;
    }
  }
  isContributingClosed(ae) {
    switch (this.fillrule) {
      case 2 /* Positive */:
        if (ae.windCount !== 1) return false;
        break;
      case 3 /* Negative */:
        if (ae.windCount !== -1) return false;
        break;
      case 1 /* NonZero */:
        if (Math.abs(ae.windCount) !== 1) return false;
        break;
    }
    switch (this.cliptype) {
      case 1 /* Intersection */:
        return this.fillrule === 2 /* Positive */ ? ae.windCount2 > 0 : this.fillrule === 3 /* Negative */ ? ae.windCount2 < 0 : ae.windCount2 !== 0;
      case 2 /* Union */:
        return this.fillrule === 2 /* Positive */ ? ae.windCount2 <= 0 : this.fillrule === 3 /* Negative */ ? ae.windCount2 >= 0 : ae.windCount2 === 0;
      case 3 /* Difference */:
        const result = this.fillrule === 2 /* Positive */ ? ae.windCount2 <= 0 : this.fillrule === 3 /* Negative */ ? ae.windCount2 >= 0 : ae.windCount2 === 0;
        return _ClipperBase.getPolyType(ae) === 0 /* Subject */ ? result : !result;
      case 4 /* Xor */:
        return true;
      // XOr is always contributing unless open
      default:
        return false;
    }
  }
  addLocalMinPoly(ae1, ae2, pt, isNew = false) {
    const outrec = this.newOutRec();
    ae1.outrec = outrec;
    ae2.outrec = outrec;
    if (_ClipperBase.isOpen(ae1)) {
      outrec.owner = null;
      outrec.isOpen = true;
      if (ae1.windDx > 0) {
        this.setSides(outrec, ae1, ae2);
      } else {
        this.setSides(outrec, ae2, ae1);
      }
    } else {
      outrec.isOpen = false;
      const prevHotEdge = _ClipperBase.getPrevHotEdge(ae1);
      if (prevHotEdge !== null) {
        if (this.usingPolytree) {
          this.setOwner(outrec, prevHotEdge.outrec);
        }
        outrec.owner = prevHotEdge.outrec;
        if (this.outrecIsAscending(prevHotEdge) === isNew) {
          this.setSides(outrec, ae2, ae1);
        } else {
          this.setSides(outrec, ae1, ae2);
        }
      } else {
        outrec.owner = null;
        if (isNew) {
          this.setSides(outrec, ae1, ae2);
        } else {
          this.setSides(outrec, ae2, ae1);
        }
      }
    }
    const op = new OutPt(pt, outrec);
    outrec.pts = op;
    return op;
  }
  outrecIsAscending(hotEdge) {
    return hotEdge === hotEdge.outrec.frontEdge;
  }
  newOutRec() {
    const result = new OutRec();
    result.idx = this.outrecList.length;
    this.outrecList.push(result);
    return result;
  }
  startOpenPath(ae, pt) {
    const outrec = this.newOutRec();
    outrec.isOpen = true;
    if (ae.windDx > 0) {
      outrec.frontEdge = ae;
      outrec.backEdge = null;
    } else {
      outrec.frontEdge = null;
      outrec.backEdge = ae;
    }
    ae.outrec = outrec;
    const op = new OutPt(pt, outrec);
    outrec.pts = op;
    return op;
  }
  checkJoinLeft(ae, pt, checkCurrX = false) {
    const prev = ae.prevInAEL;
    if (prev === null || !_ClipperBase.isHotEdge(ae) || !_ClipperBase.isHotEdge(prev) || _ClipperBase.isHorizontal(ae) || _ClipperBase.isHorizontal(prev) || _ClipperBase.isOpen(ae) || _ClipperBase.isOpen(prev)) return;
    if ((pt.y < ae.top.y + 2 || pt.y < prev.top.y + 2) && // avoid trivial joins
    (ae.bot.y > pt.y || prev.bot.y > pt.y)) return;
    if (checkCurrX) {
      if (this.perpendicDistFromLineSqrd(pt, prev.bot, prev.top) > 0.25) return;
    } else if (ae.curX !== prev.curX) return;
    if (!InternalClipper.isCollinear(ae.top, pt, prev.top)) return;
    if (ae.outrec.idx === prev.outrec.idx) {
      this.addLocalMaxPoly(prev, ae, pt);
    } else if (ae.outrec.idx < prev.outrec.idx) {
      this.joinOutrecPaths(ae, prev);
    } else {
      this.joinOutrecPaths(prev, ae);
    }
    prev.joinWith = 2 /* Right */;
    ae.joinWith = 1 /* Left */;
  }
  checkJoinRight(ae, pt, checkCurrX = false) {
    const next = ae.nextInAEL;
    if (next === null || !_ClipperBase.isHotEdge(ae) || !_ClipperBase.isHotEdge(next) || _ClipperBase.isHorizontal(ae) || _ClipperBase.isHorizontal(next) || _ClipperBase.isOpen(ae) || _ClipperBase.isOpen(next)) return;
    if ((pt.y < ae.top.y + 2 || pt.y < next.top.y + 2) && // avoid trivial joins
    (ae.bot.y > pt.y || next.bot.y > pt.y)) return;
    if (checkCurrX) {
      if (this.perpendicDistFromLineSqrd(pt, next.bot, next.top) > 0.25) return;
    } else if (ae.curX !== next.curX) return;
    if (!InternalClipper.isCollinear(ae.top, pt, next.top)) return;
    if (ae.outrec.idx === next.outrec.idx) {
      this.addLocalMaxPoly(ae, next, pt);
    } else if (ae.outrec.idx < next.outrec.idx) {
      this.joinOutrecPaths(ae, next);
    } else {
      this.joinOutrecPaths(next, ae);
    }
    ae.joinWith = 2 /* Right */;
    next.joinWith = 1 /* Left */;
  }
  perpendicDistFromLineSqrd(pt, line1, line2) {
    const a = pt.x - line1.x;
    const b = pt.y - line1.y;
    const c = line2.x - line1.x;
    const d = line2.y - line1.y;
    if (c === 0 && d === 0) return 0;
    return (a * d - c * b) * (a * d - c * b) / (c * c + d * d);
  }
  intersectEdges(ae1, ae2, pt) {
    let resultOp = null;
    if (this.hasOpenPaths && (_ClipperBase.isOpen(ae1) || _ClipperBase.isOpen(ae2))) {
      if (_ClipperBase.isOpen(ae1) && _ClipperBase.isOpen(ae2)) return;
      if (_ClipperBase.isOpen(ae2)) [ae1, ae2] = _ClipperBase.swapActives(ae1, ae2);
      if (this.isJoined(ae2)) this.split(ae2, pt);
      if (this.cliptype === 2 /* Union */) {
        if (!_ClipperBase.isHotEdge(ae2)) return;
      } else if (ae2.localMin.polytype === 0 /* Subject */) return;
      switch (this.fillrule) {
        case 2 /* Positive */:
          if (ae2.windCount !== 1) return;
          break;
        case 3 /* Negative */:
          if (ae2.windCount !== -1) return;
          break;
        default:
          if (Math.abs(ae2.windCount) !== 1) return;
          break;
      }
      if (_ClipperBase.isHotEdge(ae1)) {
        resultOp = this.addOutPt(ae1, pt);
        if (_ClipperBase.isFront(ae1)) {
          ae1.outrec.frontEdge = null;
        } else {
          ae1.outrec.backEdge = null;
        }
        ae1.outrec = null;
      } else if (pt.x === ae1.localMin.vertex.pt.x && pt.y === ae1.localMin.vertex.pt.y && !_ClipperBase.isOpenEndVertex(ae1.localMin.vertex)) {
        const ae3 = this.findEdgeWithMatchingLocMin(ae1);
        if (ae3 !== null && _ClipperBase.isHotEdge(ae3)) {
          ae1.outrec = ae3.outrec;
          if (ae1.windDx > 0) {
            this.setSides(ae3.outrec, ae1, ae3);
          } else {
            this.setSides(ae3.outrec, ae3, ae1);
          }
          return;
        }
        resultOp = this.startOpenPath(ae1, pt);
      } else {
        resultOp = this.startOpenPath(ae1, pt);
      }
      return;
    }
    if (this.isJoined(ae1)) this.split(ae1, pt);
    if (this.isJoined(ae2)) this.split(ae2, pt);
    let oldE1WindCount, oldE2WindCount;
    if (ae1.localMin.polytype === ae2.localMin.polytype) {
      if (this.fillrule === 0 /* EvenOdd */) {
        oldE1WindCount = ae1.windCount;
        ae1.windCount = ae2.windCount;
        ae2.windCount = oldE1WindCount;
      } else {
        if (ae1.windCount + ae2.windDx === 0) {
          ae1.windCount = -ae1.windCount;
        } else {
          ae1.windCount += ae2.windDx;
        }
        if (ae2.windCount - ae1.windDx === 0) {
          ae2.windCount = -ae2.windCount;
        } else {
          ae2.windCount -= ae1.windDx;
        }
      }
    } else {
      if (this.fillrule !== 0 /* EvenOdd */) {
        ae1.windCount2 += ae2.windDx;
      } else {
        ae1.windCount2 = ae1.windCount2 === 0 ? 1 : 0;
      }
      if (this.fillrule !== 0 /* EvenOdd */) {
        ae2.windCount2 -= ae1.windDx;
      } else {
        ae2.windCount2 = ae2.windCount2 === 0 ? 1 : 0;
      }
    }
    switch (this.fillrule) {
      case 2 /* Positive */:
        oldE1WindCount = ae1.windCount;
        oldE2WindCount = ae2.windCount;
        break;
      case 3 /* Negative */:
        oldE1WindCount = -ae1.windCount;
        oldE2WindCount = -ae2.windCount;
        break;
      default:
        oldE1WindCount = Math.abs(ae1.windCount);
        oldE2WindCount = Math.abs(ae2.windCount);
        break;
    }
    const e1WindCountIs0or1 = oldE1WindCount === 0 || oldE1WindCount === 1;
    const e2WindCountIs0or1 = oldE2WindCount === 0 || oldE2WindCount === 1;
    if (!_ClipperBase.isHotEdge(ae1) && !e1WindCountIs0or1 || !_ClipperBase.isHotEdge(ae2) && !e2WindCountIs0or1) return;
    if (_ClipperBase.isHotEdge(ae1) && _ClipperBase.isHotEdge(ae2)) {
      if (oldE1WindCount !== 0 && oldE1WindCount !== 1 || oldE2WindCount !== 0 && oldE2WindCount !== 1 || ae1.localMin.polytype !== ae2.localMin.polytype && this.cliptype !== 4 /* Xor */) {
        resultOp = this.addLocalMaxPoly(ae1, ae2, pt);
      } else if (_ClipperBase.isFront(ae1) || ae1.outrec === ae2.outrec) {
        resultOp = this.addLocalMaxPoly(ae1, ae2, pt);
        this.addLocalMinPoly(ae1, ae2, pt);
      } else {
        resultOp = this.addOutPt(ae1, pt);
        this.addOutPt(ae2, pt);
        this.swapOutrecs(ae1, ae2);
      }
    } else if (_ClipperBase.isHotEdge(ae1)) {
      resultOp = this.addOutPt(ae1, pt);
      this.swapOutrecs(ae1, ae2);
    } else if (_ClipperBase.isHotEdge(ae2)) {
      resultOp = this.addOutPt(ae2, pt);
      this.swapOutrecs(ae1, ae2);
    } else {
      let e1Wc2, e2Wc2;
      switch (this.fillrule) {
        case 2 /* Positive */:
          e1Wc2 = ae1.windCount2;
          e2Wc2 = ae2.windCount2;
          break;
        case 3 /* Negative */:
          e1Wc2 = -ae1.windCount2;
          e2Wc2 = -ae2.windCount2;
          break;
        default:
          e1Wc2 = Math.abs(ae1.windCount2);
          e2Wc2 = Math.abs(ae2.windCount2);
          break;
      }
      if (!_ClipperBase.isSamePolyType(ae1, ae2)) {
        resultOp = this.addLocalMinPoly(ae1, ae2, pt);
      } else if (oldE1WindCount === 1 && oldE2WindCount === 1) {
        resultOp = null;
        switch (this.cliptype) {
          case 2 /* Union */:
            if (e1Wc2 > 0 && e2Wc2 > 0) return;
            resultOp = this.addLocalMinPoly(ae1, ae2, pt);
            break;
          case 3 /* Difference */:
            if (_ClipperBase.getPolyType(ae1) === 1 /* Clip */ && e1Wc2 > 0 && e2Wc2 > 0 || _ClipperBase.getPolyType(ae1) === 0 /* Subject */ && e1Wc2 <= 0 && e2Wc2 <= 0) {
              resultOp = this.addLocalMinPoly(ae1, ae2, pt);
            }
            break;
          case 4 /* Xor */:
            resultOp = this.addLocalMinPoly(ae1, ae2, pt);
            break;
          default:
            if (e1Wc2 <= 0 || e2Wc2 <= 0) return;
            resultOp = this.addLocalMinPoly(ae1, ae2, pt);
            break;
        }
      }
    }
  }
  swapPositionsInAEL(ae1, ae2) {
    const next = ae2.nextInAEL;
    if (next !== null) next.prevInAEL = ae1;
    const prev = ae1.prevInAEL;
    if (prev !== null) prev.nextInAEL = ae2;
    ae2.prevInAEL = prev;
    ae2.nextInAEL = ae1;
    ae1.prevInAEL = ae2;
    ae1.nextInAEL = next;
    if (ae2.prevInAEL === null) this.actives = ae2;
  }
  isValidAelOrder(resident, newcomer) {
    if (newcomer.curX !== resident.curX) {
      return newcomer.curX > resident.curX;
    }
    const d = InternalClipper.crossProduct(resident.top, newcomer.bot, newcomer.top);
    if (d !== 0) return d < 0;
    if (!_ClipperBase.isMaxima(resident) && resident.top.y > newcomer.top.y) {
      return InternalClipper.crossProduct(
        newcomer.bot,
        resident.top,
        _ClipperBase.nextVertex(resident).pt
      ) <= 0;
    }
    if (!_ClipperBase.isMaxima(newcomer) && newcomer.top.y > resident.top.y) {
      return InternalClipper.crossProduct(
        newcomer.bot,
        newcomer.top,
        _ClipperBase.nextVertex(newcomer).pt
      ) >= 0;
    }
    const y = newcomer.bot.y;
    const newcomerIsLeft = newcomer.isLeftBound;
    if (resident.bot.y !== y || resident.localMin.vertex.pt.y !== y) {
      return newcomer.isLeftBound;
    }
    if (resident.isLeftBound !== newcomerIsLeft) {
      return newcomerIsLeft;
    }
    if (InternalClipper.isCollinear(
      _ClipperBase.prevPrevVertex(resident).pt,
      resident.bot,
      resident.top
    )) return true;
    return InternalClipper.crossProduct(
      _ClipperBase.prevPrevVertex(resident).pt,
      newcomer.bot,
      _ClipperBase.prevPrevVertex(newcomer).pt
    ) > 0 === newcomerIsLeft;
  }
  isJoined(e) {
    return e.joinWith !== 0 /* None */;
  }
  split(e, currPt) {
    if (e.joinWith === 2 /* Right */) {
      e.joinWith = 0 /* None */;
      e.nextInAEL.joinWith = 0 /* None */;
      this.addLocalMinPoly(e, e.nextInAEL, currPt, true);
    } else {
      e.joinWith = 0 /* None */;
      e.prevInAEL.joinWith = 0 /* None */;
      this.addLocalMinPoly(e.prevInAEL, e, currPt, true);
    }
  }
  setSides(outrec, startEdge, endEdge) {
    outrec.frontEdge = startEdge;
    outrec.backEdge = endEdge;
  }
  findEdgeWithMatchingLocMin(e) {
    let result = e.nextInAEL;
    while (result !== null) {
      if (result.localMin?.equals(e.localMin)) return result;
      if (!_ClipperBase.isHorizontal(result) && !(e.bot.x === result.bot.x && e.bot.y === result.bot.y)) result = null;
      else result = result.nextInAEL;
    }
    result = e.prevInAEL;
    while (result !== null) {
      if (result.localMin?.equals(e.localMin)) return result;
      if (!_ClipperBase.isHorizontal(result) && !(e.bot.x === result.bot.x && e.bot.y === result.bot.y)) return null;
      result = result.prevInAEL;
    }
    return result;
  }
  addOutPt(ae, pt) {
    const outrec = ae.outrec;
    const toFront = _ClipperBase.isFront(ae);
    const opFront = outrec.pts;
    const opBack = opFront.next;
    if (toFront && pt.x === opFront.pt.x && pt.y === opFront.pt.y) {
      return opFront;
    } else if (!toFront && pt.x === opBack.pt.x && pt.y === opBack.pt.y) {
      return opBack;
    }
    const newOp = new OutPt(pt, outrec);
    opBack.prev = newOp;
    newOp.prev = opFront;
    newOp.next = opBack;
    opFront.next = newOp;
    if (toFront) outrec.pts = newOp;
    return newOp;
  }
  addLocalMaxPoly(ae1, ae2, pt) {
    if (this.isJoined(ae1)) this.split(ae1, pt);
    if (this.isJoined(ae2)) this.split(ae2, pt);
    if (_ClipperBase.isFront(ae1) === _ClipperBase.isFront(ae2)) {
      if (_ClipperBase.isOpenEnd(ae1)) {
        this.swapFrontBackSides(ae1.outrec);
      } else if (_ClipperBase.isOpenEnd(ae2)) {
        this.swapFrontBackSides(ae2.outrec);
      } else {
        this.succeeded = false;
        return null;
      }
    }
    const result = this.addOutPt(ae1, pt);
    if (ae1.outrec === ae2.outrec) {
      const outrec = ae1.outrec;
      outrec.pts = result;
      if (this.usingPolytree) {
        const e = _ClipperBase.getPrevHotEdge(ae1);
        if (e === null) {
          outrec.owner = null;
        } else {
          this.setOwner(outrec, e.outrec);
        }
      }
      this.uncoupleOutRec(ae1);
    } else if (_ClipperBase.isOpen(ae1)) {
      if (ae1.windDx < 0) {
        this.joinOutrecPaths(ae1, ae2);
      } else {
        this.joinOutrecPaths(ae2, ae1);
      }
    } else if (ae1.outrec.idx < ae2.outrec.idx) {
      this.joinOutrecPaths(ae1, ae2);
    } else {
      this.joinOutrecPaths(ae2, ae1);
    }
    return result;
  }
  swapFrontBackSides(outrec) {
    const ae2 = outrec.frontEdge;
    outrec.frontEdge = outrec.backEdge;
    outrec.backEdge = ae2;
    outrec.pts = outrec.pts.next;
  }
  setOwner(outrec, newOwner) {
    while (newOwner.owner !== null && newOwner.owner.pts === null) {
      newOwner.owner = newOwner.owner.owner;
    }
    let tmp = newOwner;
    while (tmp !== null && tmp !== outrec) {
      tmp = tmp.owner;
    }
    if (tmp !== null) {
      newOwner.owner = outrec.owner;
    }
    outrec.owner = newOwner;
  }
  uncoupleOutRec(ae) {
    const outrec = ae.outrec;
    if (outrec === null) return;
    outrec.frontEdge.outrec = null;
    outrec.backEdge.outrec = null;
    outrec.frontEdge = null;
    outrec.backEdge = null;
  }
  joinOutrecPaths(ae1, ae2) {
    const p1Start = ae1.outrec.pts;
    const p2Start = ae2.outrec.pts;
    const p1End = p1Start.next;
    const p2End = p2Start.next;
    if (_ClipperBase.isFront(ae1)) {
      p2End.prev = p1Start;
      p1Start.next = p2End;
      p2Start.next = p1End;
      p1End.prev = p2Start;
      ae1.outrec.pts = p2Start;
      ae1.outrec.frontEdge = ae2.outrec.frontEdge;
      if (ae1.outrec.frontEdge !== null) {
        ae1.outrec.frontEdge.outrec = ae1.outrec;
      }
    } else {
      p1End.prev = p2Start;
      p2Start.next = p1End;
      p1Start.next = p2End;
      p2End.prev = p1Start;
      ae1.outrec.backEdge = ae2.outrec.backEdge;
      if (ae1.outrec.backEdge !== null) {
        ae1.outrec.backEdge.outrec = ae1.outrec;
      }
    }
    ae2.outrec.frontEdge = null;
    ae2.outrec.backEdge = null;
    ae2.outrec.pts = null;
    this.setOwner(ae2.outrec, ae1.outrec);
    if (_ClipperBase.isOpenEnd(ae1)) {
      ae2.outrec.pts = ae1.outrec.pts;
      ae1.outrec.pts = null;
    }
    ae1.outrec = null;
    ae2.outrec = null;
  }
  swapOutrecs(ae1, ae2) {
    const or1 = ae1.outrec;
    const or2 = ae2.outrec;
    if (or1 === or2) {
      const ae = or1.frontEdge;
      or1.frontEdge = or1.backEdge;
      or1.backEdge = ae;
      return;
    }
    if (or1 !== null) {
      if (ae1 === or1.frontEdge) {
        or1.frontEdge = ae2;
      } else {
        or1.backEdge = ae2;
      }
    }
    if (or2 !== null) {
      if (ae2 === or2.frontEdge) {
        or2.frontEdge = ae1;
      } else {
        or2.backEdge = ae1;
      }
    }
    ae1.outrec = or2;
    ae2.outrec = or1;
  }
  disposeIntersectNodes() {
    this.intersectList.length = 0;
  }
  static ptsReallyClose(pt1, pt2) {
    return Math.abs(pt1.x - pt2.x) < 2 && Math.abs(pt1.y - pt2.y) < 2;
  }
  static isVerySmallTriangle(op) {
    return op.next.next === op.prev && (_ClipperBase.ptsReallyClose(op.prev.pt, op.next.pt) || _ClipperBase.ptsReallyClose(op.pt, op.next.pt) || _ClipperBase.ptsReallyClose(op.pt, op.prev.pt));
  }
  static buildPath(op, reverse, isOpen, path) {
    if (op === null || op.next === op || !isOpen && op.next === op.prev) return false;
    path.length = 0;
    let lastPt;
    let op2;
    if (reverse) {
      lastPt = op.pt;
      op2 = op.prev;
    } else {
      op = op.next;
      lastPt = op.pt;
      op2 = op.next;
    }
    path.push(lastPt);
    while (op2 !== op) {
      if (!(op2.pt.x === lastPt.x && op2.pt.y === lastPt.y)) {
        lastPt = op2.pt;
        path.push(lastPt);
      }
      if (reverse) {
        op2 = op2.prev;
      } else {
        op2 = op2.next;
      }
    }
    return path.length !== 3 || isOpen || !_ClipperBase.isVerySmallTriangle(op2);
  }
  buildPaths(solutionClosed, solutionOpen) {
    solutionClosed.length = 0;
    solutionOpen.length = 0;
    let i = 0;
    while (i < this.outrecList.length) {
      const outrec = this.outrecList[i++];
      if (outrec.pts === null) continue;
      const path = [];
      if (outrec.isOpen) {
        if (_ClipperBase.buildPath(outrec.pts, this.reverseSolution, true, path)) {
          solutionOpen.push(path);
        }
      } else {
        this.cleanCollinear(outrec);
        if (_ClipperBase.buildPath(outrec.pts, this.reverseSolution, false, path)) {
          solutionClosed.push(path);
        }
      }
    }
    return true;
  }
  buildTree(polytree, solutionOpen) {
    polytree.clear();
    solutionOpen.length = 0;
    let i = 0;
    while (i < this.outrecList.length) {
      const outrec = this.outrecList[i++];
      if (outrec.pts === null) continue;
      if (outrec.isOpen) {
        const openPath = [];
        if (_ClipperBase.buildPath(outrec.pts, this.reverseSolution, true, openPath)) {
          solutionOpen.push(openPath);
        }
        continue;
      }
      if (this.checkBounds(outrec)) {
        this.recursiveCheckOwners(outrec, polytree);
      }
    }
  }
  checkBounds(outrec) {
    if (outrec.pts === null) return false;
    if (!Rect64Utils.isEmpty(outrec.bounds)) return true;
    this.cleanCollinear(outrec);
    if (outrec.pts === null || !_ClipperBase.buildPath(outrec.pts, this.reverseSolution, false, outrec.path)) {
      return false;
    }
    outrec.bounds = InternalClipper.getBounds(outrec.path);
    return true;
  }
  recursiveCheckOwners(outrec, polypath) {
    if (outrec.polypath !== null || Rect64Utils.isEmpty(outrec.bounds)) return;
    while (outrec.owner !== null) {
      if (outrec.owner.splits !== null && this.checkSplitOwner(outrec, outrec.owner.splits)) break;
      if (outrec.owner.pts !== null && this.checkBounds(outrec.owner) && this.path1InsidePath2(outrec.pts, outrec.owner.pts)) break;
      outrec.owner = outrec.owner.owner;
    }
    if (outrec.owner !== null) {
      if (outrec.owner.polypath === null) {
        this.recursiveCheckOwners(outrec.owner, polypath);
      }
      outrec.polypath = outrec.owner.polypath.addChild(outrec.path);
    } else {
      outrec.polypath = polypath.addChild(outrec.path);
    }
  }
  cleanCollinear(outrec) {
    outrec = this.getRealOutRec(outrec);
    if (outrec === null || outrec.isOpen) return;
    if (!this.isValidClosedPath(outrec.pts)) {
      outrec.pts = null;
      return;
    }
    let startOp = outrec.pts;
    let op2 = startOp;
    while (true) {
      if (op2 !== null && InternalClipper.isCollinear(op2.prev.pt, op2.pt, op2.next.pt) && (op2.pt.x === op2.prev.pt.x && op2.pt.y === op2.prev.pt.y || op2.pt.x === op2.next.pt.x && op2.pt.y === op2.next.pt.y || !this.preserveCollinear || InternalClipper.dotProduct(op2.prev.pt, op2.pt, op2.next.pt) < 0)) {
        if (op2 === outrec.pts) {
          outrec.pts = op2.prev;
        }
        op2 = this.disposeOutPt(op2);
        if (!this.isValidClosedPath(op2)) {
          outrec.pts = null;
          return;
        }
        startOp = op2;
        continue;
      }
      if (op2 === null) break;
      op2 = op2.next;
      if (op2 === startOp) break;
    }
    this.fixSelfIntersects(outrec);
  }
  isValidClosedPath(op) {
    return op !== null && op.next !== op && (op.next !== op.prev || !_ClipperBase.isVerySmallTriangle(op));
  }
  disposeOutPt(op) {
    const result = op.next === op ? null : op.next;
    op.prev.next = op.next;
    op.next.prev = op.prev;
    return result;
  }
  fixSelfIntersects(outrec) {
    let op2 = outrec.pts;
    if (op2.prev === op2.next.next) {
      return;
    }
    while (true) {
      if (op2.next && op2.next.next && // optimization (not in C# reference): bbox check before segsIntersect  
      this.boundingBoxesOverlap(op2.prev.pt, op2.pt, op2.next.pt, op2.next.next.pt) && // TEST: Bbox only
      InternalClipper.segsIntersect(op2.prev.pt, op2.pt, op2.next.pt, op2.next.next.pt)) {
        if (op2.next.next.next && // optimization (not in C# reference): bbox check before segsIntersect
        this.boundingBoxesOverlap(op2.prev.pt, op2.pt, op2.next.next.pt, op2.next.next.next.pt) && // TEST: Bbox only
        InternalClipper.segsIntersect(op2.prev.pt, op2.pt, op2.next.next.pt, op2.next.next.next.pt)) {
          op2 = this.duplicateOp(op2, false);
          op2.pt = op2.next.next.next.pt;
          op2 = op2.next;
        } else {
          if (op2 === outrec.pts || op2.next === outrec.pts) {
            outrec.pts = outrec.pts.prev;
          }
          this.doSplitOp(outrec, op2);
          if (outrec.pts === null) return;
          op2 = outrec.pts;
          if (op2.prev === op2.next.next) break;
          continue;
        }
      }
      op2 = op2.next;
      if (op2 === outrec.pts) break;
    }
  }
  doSplitOp(outrec, splitOp) {
    const prevOp = splitOp.prev;
    const nextNextOp = splitOp.next.next;
    outrec.pts = prevOp;
    const intersectResult = InternalClipper.getLineIntersectPt(
      prevOp.pt,
      splitOp.pt,
      splitOp.next.pt,
      nextNextOp.pt
    );
    const ip = intersectResult.point;
    const area1 = _ClipperBase.areaOutPt(prevOp);
    const absArea1 = Math.abs(area1);
    if (absArea1 < 2) {
      outrec.pts = null;
      return;
    }
    const area2 = this.areaTriangle(ip, splitOp.pt, splitOp.next.pt);
    const absArea2 = Math.abs(area2);
    if (ip.x === prevOp.pt.x && ip.y === prevOp.pt.y || ip.x === nextNextOp.pt.x && ip.y === nextNextOp.pt.y) {
      nextNextOp.prev = prevOp;
      prevOp.next = nextNextOp;
    } else {
      const newOp2 = new OutPt(ip, outrec);
      newOp2.prev = prevOp;
      newOp2.next = nextNextOp;
      nextNextOp.prev = newOp2;
      prevOp.next = newOp2;
    }
    if (!(absArea2 > 1) || !(absArea2 > absArea1) && area2 > 0 !== area1 > 0) return;
    const newOutRec = this.newOutRec();
    newOutRec.owner = outrec.owner;
    splitOp.outrec = newOutRec;
    splitOp.next.outrec = newOutRec;
    const newOp = new OutPt(ip, newOutRec);
    newOp.prev = splitOp.next;
    newOp.next = splitOp;
    newOutRec.pts = newOp;
    splitOp.prev = newOp;
    splitOp.next.next = newOp;
    if (!this.usingPolytree) return;
    if (this.path1InsidePath2(prevOp, newOp)) {
      if (newOutRec.splits === null) newOutRec.splits = [];
      newOutRec.splits.push(outrec.idx);
    } else {
      if (outrec.splits === null) outrec.splits = [];
      outrec.splits.push(newOutRec.idx);
    }
  }
  static areaOutPt(op) {
    let area2 = 0;
    let op2 = op;
    do {
      area2 += (op2.prev.pt.y + op2.pt.y) * (op2.prev.pt.x - op2.pt.x);
      op2 = op2.next;
    } while (op2 !== op);
    return area2 * 0.5;
  }
  areaTriangle(pt1, pt2, pt3) {
    return (pt3.y + pt1.y) * (pt3.x - pt1.x) + (pt1.y + pt2.y) * (pt1.x - pt2.x) + (pt2.y + pt3.y) * (pt2.x - pt3.x);
  }
  isValidOwner(outRec, testOwner) {
    while (testOwner !== null && testOwner !== outRec) {
      testOwner = testOwner.owner;
    }
    return testOwner === null;
  }
  containsRect(rect, rec) {
    return rec.left >= rect.left && rec.right <= rect.right && rec.top >= rect.top && rec.bottom <= rect.bottom;
  }
  checkSplitOwner(outrec, splits) {
    for (let i = 0; i < splits.length; i++) {
      let split = this.outrecList[splits[i]];
      if (split.pts === null && split.splits !== null && this.checkSplitOwner(outrec, split.splits)) return true;
      split = this.getRealOutRec(split);
      if (split === null || split === outrec || split.recursiveSplit === outrec) continue;
      split.recursiveSplit = outrec;
      if (split.splits !== null && this.checkSplitOwner(outrec, split.splits)) return true;
      if (!this.checkBounds(split) || !this.containsRect(split.bounds, outrec.bounds) || !this.path1InsidePath2(outrec.pts, split.pts)) continue;
      if (!this.isValidOwner(outrec, split)) {
        split.owner = outrec.owner;
      }
      outrec.owner = split;
      return true;
    }
    return false;
  }
};
var Clipper64 = class extends ClipperBase {
  addPath(path, polytype, isOpen = false) {
    super.addPath(path, polytype, isOpen);
  }
  addReuseableData(reuseableData) {
    super.addReuseableData(reuseableData);
  }
  addPaths(paths, polytype, isOpen = false) {
    super.addPaths(paths, polytype, isOpen);
  }
  addSubject(paths) {
    this.addPaths(paths, 0 /* Subject */);
  }
  addOpenSubject(paths) {
    this.addPaths(paths, 0 /* Subject */, true);
  }
  addClip(paths) {
    this.addPaths(paths, 1 /* Clip */);
  }
  execute(clipType, fillRule, solutionOrTree, openPathsOrSolutionOpen) {
    if (Array.isArray(solutionOrTree)) {
      const solutionClosed = solutionOrTree;
      const solutionOpen = openPathsOrSolutionOpen;
      solutionClosed.length = 0;
      if (solutionOpen) solutionOpen.length = 0;
      try {
        this.executeInternal(clipType, fillRule);
        this.buildPaths(solutionClosed, solutionOpen || []);
      } catch {
        this.succeeded = false;
      }
      this.clearSolutionOnly();
      return this.succeeded;
    } else {
      const polytree = solutionOrTree;
      const openPaths = openPathsOrSolutionOpen;
      polytree.clear();
      if (openPaths) openPaths.length = 0;
      this.usingPolytree = true;
      try {
        this.executeInternal(clipType, fillRule);
        this.buildTree(polytree, openPaths || []);
      } catch {
        this.succeeded = false;
      }
      this.clearSolutionOnly();
      return this.succeeded;
    }
  }
};
var ClipperD = class extends ClipperBase {
  scale;
  invScale;
  constructor(roundingDecimalPrecision = 2) {
    super();
    InternalClipper.checkPrecision(roundingDecimalPrecision);
    this.scale = Math.pow(10, roundingDecimalPrecision);
    this.invScale = 1 / this.scale;
  }
  scalePathDFromInt(path, scale) {
    const result = [];
    for (const pt of path) {
      result.push({
        x: pt.x * scale,
        y: pt.y * scale
      });
    }
    return result;
  }
  buildPathsD(solutionClosed, solutionOpen) {
    solutionClosed.length = 0;
    solutionOpen.length = 0;
    let i = 0;
    while (i < this.outrecList.length) {
      const outrec = this.outrecList[i++];
      if (outrec.pts === null) continue;
      const path = [];
      if (outrec.isOpen) {
        if (ClipperBase.buildPath(outrec.pts, this.reverseSolution, true, path)) {
          solutionOpen.push(this.scalePathDFromInt(path, this.invScale));
        }
      } else {
        this.cleanCollinear(outrec);
        if (ClipperBase.buildPath(outrec.pts, this.reverseSolution, false, path)) {
          solutionClosed.push(this.scalePathDFromInt(path, this.invScale));
        }
      }
    }
    return true;
  }
  buildTreeD(polytree, solutionOpen) {
    polytree.clear();
    solutionOpen.length = 0;
    let i = 0;
    while (i < this.outrecList.length) {
      const outrec = this.outrecList[i++];
      if (outrec.pts === null) continue;
      if (outrec.isOpen) {
        const openPath = [];
        if (ClipperBase.buildPath(outrec.pts, this.reverseSolution, true, openPath)) {
          solutionOpen.push(this.scalePathDFromInt(openPath, this.invScale));
        }
        continue;
      }
      if (this.checkBounds(outrec)) {
        this.recursiveCheckOwners(outrec, polytree);
      }
    }
  }
  addPath(path, polytype, isOpen = false) {
    super.addPath(Clipper.scalePath64(path, this.scale), polytype, isOpen);
  }
  addPaths(paths, polytype, isOpen = false) {
    super.addPaths(Clipper.scalePaths64(paths, this.scale), polytype, isOpen);
  }
  addSubject(path) {
    this.addPath(path, 0 /* Subject */);
  }
  addOpenSubject(path) {
    this.addPath(path, 0 /* Subject */, true);
  }
  addClip(path) {
    this.addPath(path, 1 /* Clip */);
  }
  addSubjectPaths(paths) {
    this.addPaths(paths, 0 /* Subject */);
  }
  addOpenSubjectPaths(paths) {
    this.addPaths(paths, 0 /* Subject */, true);
  }
  addClipPaths(paths) {
    this.addPaths(paths, 1 /* Clip */);
  }
  execute(clipType, fillRule, solutionOrTree, openPathsOrSolutionOpen) {
    if (Array.isArray(solutionOrTree)) {
      const solutionClosed = solutionOrTree;
      const solutionOpen = openPathsOrSolutionOpen;
      const solClosed64 = [];
      const solOpen64 = [];
      solutionClosed.length = 0;
      if (solutionOpen) solutionOpen.length = 0;
      let success = true;
      try {
        this.executeInternal(clipType, fillRule);
        this.buildPaths(solClosed64, solOpen64);
      } catch {
        success = false;
      }
      this.clearSolutionOnly();
      if (!success) return false;
      for (const path of solClosed64) {
        solutionClosed.push(this.scalePathDFromInt(path, this.invScale));
      }
      if (solutionOpen) {
        for (const path of solOpen64) {
          solutionOpen.push(this.scalePathDFromInt(path, this.invScale));
        }
      }
      return true;
    } else {
      const polytree = solutionOrTree;
      const openPaths = openPathsOrSolutionOpen;
      polytree.clear();
      if (openPaths) openPaths.length = 0;
      this.usingPolytree = true;
      polytree.scale = this.scale;
      let success = true;
      try {
        this.executeInternal(clipType, fillRule);
        this.buildTreeD(polytree, openPaths || []);
      } catch {
        success = false;
      }
      this.clearSolutionOnly();
      return success;
    }
  }
};
var Clipper;
((Clipper3) => {
  function area2(path) {
    let a = 0;
    const cnt = path.length;
    if (cnt < 3) return 0;
    let prevPt = path[cnt - 1];
    for (const pt of path) {
      a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
      prevPt = pt;
    }
    return a * 0.5;
  }
  Clipper3.area = area2;
  function areaD2(path) {
    let a = 0;
    const cnt = path.length;
    if (cnt < 3) return 0;
    let prevPt = path[cnt - 1];
    for (const pt of path) {
      a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
      prevPt = pt;
    }
    return a * 0.5;
  }
  Clipper3.areaD = areaD2;
  function scalePath642(path, scale) {
    const result = [];
    for (const pt of path) {
      result.push({
        x: Math.round(pt.x * scale),
        y: Math.round(pt.y * scale)
      });
    }
    return result;
  }
  Clipper3.scalePath64 = scalePath642;
  function scalePaths642(paths, scale) {
    const result = [];
    for (const path of paths) {
      result.push(scalePath642(path, scale));
    }
    return result;
  }
  Clipper3.scalePaths64 = scalePaths642;
  function scalePathD2(path, scale) {
    const result = [];
    for (const pt of path) {
      result.push({
        x: pt.x * scale,
        y: pt.y * scale
      });
    }
    return result;
  }
  Clipper3.scalePathD = scalePathD2;
  function scalePathsD2(paths, scale) {
    const result = [];
    for (const path of paths) {
      result.push(scalePathD2(path, scale));
    }
    return result;
  }
  Clipper3.scalePathsD = scalePathsD2;
})(Clipper || (Clipper = {}));

// pkg/package/src/Offset.ts
var JoinType = /* @__PURE__ */ ((JoinType3) => {
  JoinType3[JoinType3["Miter"] = 0] = "Miter";
  JoinType3[JoinType3["Square"] = 1] = "Square";
  JoinType3[JoinType3["Bevel"] = 2] = "Bevel";
  JoinType3[JoinType3["Round"] = 3] = "Round";
  return JoinType3;
})(JoinType || {});
var EndType = /* @__PURE__ */ ((EndType3) => {
  EndType3[EndType3["Polygon"] = 0] = "Polygon";
  EndType3[EndType3["Joined"] = 1] = "Joined";
  EndType3[EndType3["Butt"] = 2] = "Butt";
  EndType3[EndType3["Square"] = 3] = "Square";
  EndType3[EndType3["Round"] = 4] = "Round";
  return EndType3;
})(EndType || {});
var Group = class {
  inPaths;
  joinType;
  endType;
  pathsReversed;
  lowestPathIdx;
  constructor(paths, joinType, endType = 0 /* Polygon */) {
    this.joinType = joinType;
    this.endType = endType;
    const isJoined = endType === 0 /* Polygon */ || endType === 1 /* Joined */;
    this.inPaths = [];
    for (const path of paths) {
      this.inPaths.push(ClipperOffset.stripDuplicates(path, isJoined));
    }
    if (endType === 0 /* Polygon */) {
      const lowestInfo = ClipperOffset.getLowestPathInfo(this.inPaths);
      this.lowestPathIdx = lowestInfo.idx;
      this.pathsReversed = this.lowestPathIdx >= 0 && lowestInfo.isNegArea;
    } else {
      this.lowestPathIdx = -1;
      this.pathsReversed = false;
    }
  }
};
var ClipperOffset = class _ClipperOffset {
  static Tolerance = 1e-12;
  // Clipper2 approximates arcs by using series of relatively short straight
  //line segments. And logically, shorter line segments will produce better arc
  // approximations. But very short segments can degrade performance, usually
  // with little or no discernable improvement in curve quality. Very short
  // segments can even detract from curve quality, due to the effects of integer
  // rounding. Since there isn't an optimal number of line segments for any given
  // arc radius (that perfectly balances curve approximation with performance),
  // arc tolerance is user defined. Nevertheless, when the user doesn't define
  // an arc tolerance (ie leaves alone the 0 default value), the calculated
  // default arc tolerance (offset_radius / 500) generally produces good (smooth)
  // arc approximations without producing excessively small segment lengths.
  // See also: https://www.angusj.com/clipper2/Docs/Trigonometry.htm
  static arc_const = 2e-3;
  // <-- 1/500
  groupList = [];
  pathOut = [];
  normals = [];
  solution = [];
  solutionTree = null;
  groupDelta = 0;
  //*0.5 for open paths; *-1.0 for negative areas
  delta = 0;
  mitLimSqr = 0;
  stepsPerRad = 0;
  stepSin = 0;
  stepCos = 0;
  joinType = 2 /* Bevel */;
  endType = 0 /* Polygon */;
  arcTolerance = 0;
  mergeGroups = true;
  miterLimit = 2;
  preserveCollinear = false;
  reverseSolution = false;
  deltaCallback = null;
  constructor(miterLimit = 2, arcTolerance = 0, preserveCollinear = false, reverseSolution = false) {
    this.miterLimit = miterLimit;
    this.arcTolerance = arcTolerance;
    this.mergeGroups = true;
    this.preserveCollinear = preserveCollinear;
    this.reverseSolution = reverseSolution;
  }
  clear() {
    this.groupList.length = 0;
  }
  addPath(path, joinType, endType) {
    if (path.length === 0) return;
    const pp = [path];
    this.addPaths(pp, joinType, endType);
  }
  addPaths(paths, joinType, endType) {
    if (paths.length === 0) return;
    this.groupList.push(new Group(paths, joinType, endType));
  }
  calcSolutionCapacity() {
    let result = 0;
    for (const g of this.groupList) {
      result += g.endType === 1 /* Joined */ ? g.inPaths.length * 2 : g.inPaths.length;
    }
    return result;
  }
  checkPathsReversed() {
    let result = false;
    for (const g of this.groupList) {
      if (g.endType === 0 /* Polygon */) {
        result = g.pathsReversed;
        break;
      }
    }
    return result;
  }
  executeInternal(delta) {
    if (this.groupList.length === 0) return;
    if (Math.abs(delta) < 0.5) {
      for (const group of this.groupList) {
        for (const path of group.inPaths) {
          this.solution.push(path);
        }
      }
      return;
    }
    this.delta = delta;
    this.mitLimSqr = this.miterLimit <= 1 ? 2 : 2 / _ClipperOffset.sqr(this.miterLimit);
    for (const group of this.groupList) {
      this.doGroupOffset(group);
    }
    if (this.groupList.length === 0) return;
    const pathsReversed = this.checkPathsReversed();
    const fillRule = pathsReversed ? 3 /* Negative */ : 2 /* Positive */;
    const c = new Clipper64();
    c.preserveCollinear = this.preserveCollinear;
    c.reverseSolution = this.reverseSolution !== pathsReversed;
    c.addSubject(this.solution);
    if (this.solutionTree !== null) {
      c.execute(2 /* Union */, fillRule, this.solutionTree);
    } else {
      c.execute(2 /* Union */, fillRule, this.solution);
    }
  }
  execute(delta, solutionOrTree) {
    if (Array.isArray(solutionOrTree)) {
      const solution = solutionOrTree;
      solution.length = 0;
      this.solution = solution;
      this.executeInternal(delta);
    } else {
      const solutionTree = solutionOrTree;
      solutionTree.clear();
      this.solutionTree = solutionTree;
      this.solution = [];
      this.executeInternal(delta);
    }
  }
  executeWithCallback(deltaCallback, solution) {
    this.deltaCallback = deltaCallback;
    this.execute(1, solution);
  }
  static getUnitNormal(pt1, pt2) {
    const dx = pt2.x - pt1.x;
    const dy = pt2.y - pt1.y;
    if (dx === 0 && dy === 0) return { x: 0, y: 0 };
    const f = 1 / Math.sqrt(dx * dx + dy * dy);
    return {
      x: dy * f,
      y: -dx * f
    };
  }
  static getLowestPathInfo(paths) {
    let idx = -1;
    let isNegArea = false;
    let botPt = { x: Number.MAX_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER };
    for (let i = 0; i < paths.length; ++i) {
      let a = Number.MAX_VALUE;
      for (const pt of paths[i]) {
        if (pt.y < botPt.y || pt.y === botPt.y && pt.x >= botPt.x) continue;
        if (a === Number.MAX_VALUE) {
          a = _ClipperOffset.area(paths[i]);
          if (a === 0) break;
          isNegArea = a < 0;
        }
        idx = i;
        botPt.x = pt.x;
        botPt.y = pt.y;
      }
    }
    return { idx, isNegArea };
  }
  static translatePoint(pt, dx, dy) {
    return { x: pt.x + dx, y: pt.y + dy };
  }
  static reflectPoint(pt, pivot) {
    return { x: pivot.x + (pivot.x - pt.x), y: pivot.y + (pivot.y - pt.y) };
  }
  static almostZero(value, epsilon = 1e-3) {
    return Math.abs(value) < epsilon;
  }
  static hypotenuse(x, y) {
    return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
  }
  static normalizeVector(vec) {
    const h = _ClipperOffset.hypotenuse(vec.x, vec.y);
    if (_ClipperOffset.almostZero(h)) return { x: 0, y: 0 };
    const inverseHypot = 1 / h;
    return { x: vec.x * inverseHypot, y: vec.y * inverseHypot };
  }
  static getAvgUnitVector(vec1, vec2) {
    return _ClipperOffset.normalizeVector({ x: vec1.x + vec2.x, y: vec1.y + vec2.y });
  }
  static intersectPoint(pt1a, pt1b, pt2a, pt2b) {
    if (InternalClipper.isAlmostZero(pt1a.x - pt1b.x)) {
      if (InternalClipper.isAlmostZero(pt2a.x - pt2b.x)) return { x: 0, y: 0 };
      const m2 = (pt2b.y - pt2a.y) / (pt2b.x - pt2a.x);
      const b2 = pt2a.y - m2 * pt2a.x;
      return { x: pt1a.x, y: m2 * pt1a.x + b2 };
    }
    if (InternalClipper.isAlmostZero(pt2a.x - pt2b.x)) {
      const m1 = (pt1b.y - pt1a.y) / (pt1b.x - pt1a.x);
      const b1 = pt1a.y - m1 * pt1a.x;
      return { x: pt2a.x, y: m1 * pt2a.x + b1 };
    } else {
      const m1 = (pt1b.y - pt1a.y) / (pt1b.x - pt1a.x);
      const b1 = pt1a.y - m1 * pt1a.x;
      const m2 = (pt2b.y - pt2a.y) / (pt2b.x - pt2a.x);
      const b2 = pt2a.y - m2 * pt2a.x;
      if (InternalClipper.isAlmostZero(m1 - m2)) return { x: 0, y: 0 };
      const x = (b2 - b1) / (m1 - m2);
      return { x, y: m1 * x + b1 };
    }
  }
  getPerpendic(pt, norm) {
    return {
      x: Math.round(pt.x + norm.x * this.groupDelta),
      y: Math.round(pt.y + norm.y * this.groupDelta)
    };
  }
  getPerpendicD(pt, norm) {
    return {
      x: pt.x + norm.x * this.groupDelta,
      y: pt.y + norm.y * this.groupDelta
    };
  }
  doBevel(path, j, k) {
    let pt1, pt2;
    if (j === k) {
      const absDelta = Math.abs(this.groupDelta);
      pt1 = {
        x: Math.round(path[j].x - absDelta * this.normals[j].x),
        y: Math.round(path[j].y - absDelta * this.normals[j].y)
      };
      pt2 = {
        x: Math.round(path[j].x + absDelta * this.normals[j].x),
        y: Math.round(path[j].y + absDelta * this.normals[j].y)
      };
    } else {
      pt1 = {
        x: Math.round(path[j].x + this.groupDelta * this.normals[k].x),
        y: Math.round(path[j].y + this.groupDelta * this.normals[k].y)
      };
      pt2 = {
        x: Math.round(path[j].x + this.groupDelta * this.normals[j].x),
        y: Math.round(path[j].y + this.groupDelta * this.normals[j].y)
      };
    }
    this.pathOut.push(pt1);
    this.pathOut.push(pt2);
  }
  doSquare(path, j, k) {
    let vec;
    if (j === k) {
      vec = { x: this.normals[j].y, y: -this.normals[j].x };
    } else {
      vec = _ClipperOffset.getAvgUnitVector(
        { x: -this.normals[k].y, y: this.normals[k].x },
        { x: this.normals[j].y, y: -this.normals[j].x }
      );
    }
    const absDelta = Math.abs(this.groupDelta);
    let ptQ = { x: path[j].x, y: path[j].y };
    ptQ = _ClipperOffset.translatePoint(ptQ, absDelta * vec.x, absDelta * vec.y);
    const pt1 = _ClipperOffset.translatePoint(ptQ, this.groupDelta * vec.y, this.groupDelta * -vec.x);
    const pt2 = _ClipperOffset.translatePoint(ptQ, this.groupDelta * -vec.y, this.groupDelta * vec.x);
    const pt3 = this.getPerpendicD(path[k], this.normals[k]);
    if (j === k) {
      const pt4 = {
        x: pt3.x + vec.x * this.groupDelta,
        y: pt3.y + vec.y * this.groupDelta
      };
      const pt = _ClipperOffset.intersectPoint(pt1, pt2, pt3, pt4);
      this.pathOut.push(Point64Utils.fromPointD(_ClipperOffset.reflectPoint(pt, ptQ)));
      this.pathOut.push(Point64Utils.fromPointD(pt));
    } else {
      const pt4 = this.getPerpendicD(path[j], this.normals[k]);
      const pt = _ClipperOffset.intersectPoint(pt1, pt2, pt3, pt4);
      this.pathOut.push(Point64Utils.fromPointD(pt));
      this.pathOut.push(Point64Utils.fromPointD(_ClipperOffset.reflectPoint(pt, ptQ)));
    }
  }
  doMiter(path, j, k, cosA) {
    const q = this.groupDelta / (cosA + 1);
    this.pathOut.push({
      x: Math.round(path[j].x + (this.normals[k].x + this.normals[j].x) * q),
      y: Math.round(path[j].y + (this.normals[k].y + this.normals[j].y) * q)
    });
  }
  doRound(path, j, k, angle) {
    if (this.deltaCallback !== null) {
      const absDelta = Math.abs(this.groupDelta);
      const arcTol = this.arcTolerance > 0.01 ? this.arcTolerance : absDelta * _ClipperOffset.arc_const;
      const stepsPer360 = Math.PI / Math.acos(1 - arcTol / absDelta);
      this.stepSin = Math.sin(2 * Math.PI / stepsPer360);
      this.stepCos = Math.cos(2 * Math.PI / stepsPer360);
      if (this.groupDelta < 0) this.stepSin = -this.stepSin;
      this.stepsPerRad = stepsPer360 / (2 * Math.PI);
    }
    const pt = path[j];
    let offsetVec = { x: this.normals[k].x * this.groupDelta, y: this.normals[k].y * this.groupDelta };
    if (j === k) PointDUtils.negate(offsetVec);
    this.pathOut.push({
      x: Math.round(pt.x + offsetVec.x),
      y: Math.round(pt.y + offsetVec.y)
    });
    const steps = Math.ceil(this.stepsPerRad * Math.abs(angle));
    for (let i = 1; i < steps; i++) {
      offsetVec = {
        x: offsetVec.x * this.stepCos - this.stepSin * offsetVec.y,
        y: offsetVec.x * this.stepSin + offsetVec.y * this.stepCos
      };
      this.pathOut.push({
        x: Math.round(pt.x + offsetVec.x),
        y: Math.round(pt.y + offsetVec.y)
      });
    }
    this.pathOut.push(this.getPerpendic(path[j], this.normals[j]));
  }
  buildNormals(path) {
    const cnt = path.length;
    this.normals.length = 0;
    if (cnt === 0) return;
    for (let i = 0; i < cnt - 1; i++) {
      this.normals.push(_ClipperOffset.getUnitNormal(path[i], path[i + 1]));
    }
    this.normals.push(_ClipperOffset.getUnitNormal(path[cnt - 1], path[0]));
  }
  offsetPoint(group, path, j, k) {
    if (Point64Utils.equals(path[j], path[k])) return;
    let sinA = InternalClipper.crossProductD(this.normals[j], this.normals[k]);
    const cosA = InternalClipper.dotProductD(this.normals[j], this.normals[k]);
    if (sinA > 1) sinA = 1;
    else if (sinA < -1) sinA = -1;
    if (this.deltaCallback !== null) {
      this.groupDelta = this.deltaCallback(path, this.normals, j, k);
      if (group.pathsReversed) this.groupDelta = -this.groupDelta;
    }
    if (Math.abs(this.groupDelta) < _ClipperOffset.Tolerance) {
      this.pathOut.push(path[j]);
      return;
    }
    if (cosA > -0.999 && sinA * this.groupDelta < 0) {
      this.pathOut.push(this.getPerpendic(path[j], this.normals[k]));
      this.pathOut.push(path[j]);
      this.pathOut.push(this.getPerpendic(path[j], this.normals[j]));
    } else if (cosA > 0.999 && this.joinType !== 3 /* Round */) {
      this.doMiter(path, j, k, cosA);
    } else {
      switch (this.joinType) {
        // miter unless the angle is sufficiently acute to exceed ML
        case 0 /* Miter */:
          if (cosA > this.mitLimSqr - 1) {
            this.doMiter(path, j, k, cosA);
          } else {
            this.doSquare(path, j, k);
          }
          break;
        case 3 /* Round */:
          this.doRound(path, j, k, Math.atan2(sinA, cosA));
          break;
        case 2 /* Bevel */:
          this.doBevel(path, j, k);
          break;
        default:
          this.doSquare(path, j, k);
          break;
      }
    }
  }
  offsetPolygon(group, path) {
    this.pathOut = [];
    const cnt = path.length;
    let prev = cnt - 1;
    for (let i = 0; i < cnt; i++) {
      this.offsetPoint(group, path, i, prev);
      prev = i;
    }
    this.solution.push([...this.pathOut]);
  }
  offsetOpenJoined(group, path) {
    this.offsetPolygon(group, path);
    const reversePath2 = [...path].reverse();
    this.buildNormals(reversePath2);
    this.offsetPolygon(group, reversePath2);
  }
  offsetOpenPath(group, path) {
    this.pathOut = [];
    const highI = path.length - 1;
    if (this.deltaCallback !== null) {
      this.groupDelta = this.deltaCallback(path, this.normals, 0, 0);
    }
    if (Math.abs(this.groupDelta) < _ClipperOffset.Tolerance) {
      this.pathOut.push(path[0]);
    } else {
      switch (this.endType) {
        case 2 /* Butt */:
          this.doBevel(path, 0, 0);
          break;
        case 4 /* Round */:
          this.doRound(path, 0, 0, Math.PI);
          break;
        default:
          this.doSquare(path, 0, 0);
          break;
      }
    }
    for (let i = 1, k = 0; i < highI; i++) {
      this.offsetPoint(group, path, i, k);
      k = i;
    }
    for (let i = highI; i > 0; i--) {
      this.normals[i] = { x: -this.normals[i - 1].x, y: -this.normals[i - 1].y };
    }
    this.normals[0] = this.normals[highI];
    if (this.deltaCallback !== null) {
      this.groupDelta = this.deltaCallback(path, this.normals, highI, highI);
    }
    if (Math.abs(this.groupDelta) < _ClipperOffset.Tolerance) {
      this.pathOut.push(path[highI]);
    } else {
      switch (this.endType) {
        case 2 /* Butt */:
          this.doBevel(path, highI, highI);
          break;
        case 4 /* Round */:
          this.doRound(path, highI, highI, Math.PI);
          break;
        default:
          this.doSquare(path, highI, highI);
          break;
      }
    }
    for (let i = highI - 1, k = highI; i > 0; i--) {
      this.offsetPoint(group, path, i, k);
      k = i;
    }
    this.solution.push([...this.pathOut]);
  }
  doGroupOffset(group) {
    if (group.endType === 0 /* Polygon */) {
      if (group.lowestPathIdx < 0) this.delta = Math.abs(this.delta);
      this.groupDelta = group.pathsReversed ? -this.delta : this.delta;
    } else {
      this.groupDelta = Math.abs(this.delta);
    }
    const absDelta = Math.abs(this.groupDelta);
    this.joinType = group.joinType;
    this.endType = group.endType;
    if (group.joinType === 3 /* Round */ || group.endType === 4 /* Round */) {
      const arcTol = this.arcTolerance > 0.01 ? this.arcTolerance : absDelta * _ClipperOffset.arc_const;
      const stepsPer360 = Math.PI / Math.acos(1 - arcTol / absDelta);
      this.stepSin = Math.sin(2 * Math.PI / stepsPer360);
      this.stepCos = Math.cos(2 * Math.PI / stepsPer360);
      if (this.groupDelta < 0) this.stepSin = -this.stepSin;
      this.stepsPerRad = stepsPer360 / (2 * Math.PI);
    }
    for (const pathIn of group.inPaths) {
      this.pathOut = [];
      const cnt = pathIn.length;
      if (cnt === 1) {
        const pt = pathIn[0];
        if (this.deltaCallback !== null) {
          this.groupDelta = this.deltaCallback(pathIn, this.normals, 0, 0);
          if (group.pathsReversed) this.groupDelta = -this.groupDelta;
        }
        if (group.endType === 4 /* Round */) {
          const steps = Math.ceil(this.stepsPerRad * 2 * Math.PI);
          this.pathOut = _ClipperOffset.ellipse(pt, Math.abs(this.groupDelta), Math.abs(this.groupDelta), steps);
        } else {
          const d = Math.ceil(Math.abs(this.groupDelta));
          const r = { left: pt.x - d, top: pt.y - d, right: pt.x + d, bottom: pt.y + d };
          this.pathOut = [
            { x: r.left, y: r.top },
            { x: r.right, y: r.top },
            { x: r.right, y: r.bottom },
            { x: r.left, y: r.bottom }
          ];
        }
        this.solution.push([...this.pathOut]);
        continue;
      }
      if (cnt === 2 && group.endType === 1 /* Joined */) {
        this.endType = group.joinType === 3 /* Round */ ? 4 /* Round */ : 3 /* Square */;
      }
      this.buildNormals(pathIn);
      switch (this.endType) {
        case 0 /* Polygon */:
          this.offsetPolygon(group, pathIn);
          break;
        case 1 /* Joined */:
          this.offsetOpenJoined(group, pathIn);
          break;
        default:
          this.offsetOpenPath(group, pathIn);
          break;
      }
    }
  }
  static stripDuplicates(path, isClosedPath) {
    const cnt = path.length;
    const result = [];
    if (cnt === 0) return result;
    let lastPt = path[0];
    result.push(lastPt);
    for (let i = 1; i < cnt; i++) {
      if (!Point64Utils.equals(lastPt, path[i])) {
        lastPt = path[i];
        result.push(lastPt);
      }
    }
    if (isClosedPath && Point64Utils.equals(lastPt, result[0])) {
      result.pop();
    }
    return result;
  }
  static area(path) {
    let a = 0;
    const cnt = path.length;
    if (cnt < 3) return 0;
    let prevPt = path[cnt - 1];
    for (const pt of path) {
      a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
      prevPt = pt;
    }
    return a * 0.5;
  }
  static sqr(val) {
    return val * val;
  }
  static ellipse(center, radiusX, radiusY = 0, steps = 0) {
    if (radiusX <= 0) return [];
    if (radiusY <= 0) radiusY = radiusX;
    if (steps <= 2) {
      steps = Math.ceil(Math.PI * Math.sqrt((radiusX + radiusY) / 2));
    }
    const si = Math.sin(2 * Math.PI / steps);
    const co = Math.cos(2 * Math.PI / steps);
    let dx = co;
    let dy = si;
    const result = [{ x: Math.round(center.x + radiusX), y: center.y }];
    for (let i = 1; i < steps; ++i) {
      result.push({
        x: Math.round(center.x + radiusX * dx),
        y: Math.round(center.y + radiusY * dy)
      });
      const x = dx * co - dy * si;
      dy = dy * co + dx * si;
      dx = x;
    }
    return result;
  }
};

// pkg/package/src/RectClip.ts
var OutPt2 = class {
  next = null;
  prev = null;
  pt;
  ownerIdx = 0;
  edge = null;
  constructor(pt) {
    this.pt = pt;
  }
};
var RectClip64 = class _RectClip64 {
  rect;
  mp;
  rectPath;
  pathBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  results = [];
  edges = [];
  currIdx = -1;
  constructor(rect) {
    this.currIdx = -1;
    this.rect = rect;
    this.mp = Rect64Utils.midPoint(rect);
    this.rectPath = Rect64Utils.asPath(this.rect);
    this.results = [];
    this.edges = [];
    for (let i = 0; i < 8; i++) {
      this.edges[i] = [];
    }
  }
  add(pt, startingNewPath = false) {
    let currIdx = this.results.length;
    let result;
    if (currIdx === 0 || startingNewPath) {
      result = new OutPt2(pt);
      this.results.push(result);
      result.ownerIdx = currIdx;
      result.prev = result;
      result.next = result;
    } else {
      currIdx--;
      const prevOp = this.results[currIdx];
      if (prevOp && Point64Utils.equals(prevOp.pt, pt)) return prevOp;
      result = new OutPt2(pt);
      result.ownerIdx = currIdx;
      result.next = prevOp.next;
      prevOp.next.prev = result;
      prevOp.next = result;
      result.prev = prevOp;
      this.results[currIdx] = result;
    }
    return result;
  }
  static path1ContainsPath2(path1, path2) {
    let ioCount = 0;
    for (const pt of path2) {
      const pip = InternalClipper.pointInPolygon(pt, path1);
      switch (pip) {
        case 1 /* IsInside */:
          ioCount--;
          break;
        case 2 /* IsOutside */:
          ioCount++;
          break;
      }
      if (Math.abs(ioCount) > 1) break;
    }
    return ioCount <= 0;
  }
  static isClockwise(prev, curr, prevPt, currPt, rectMidPoint) {
    if (_RectClip64.areOpposites(prev, curr)) {
      return InternalClipper.crossProduct(prevPt, rectMidPoint, currPt) < 0;
    }
    return _RectClip64.headingClockwise(prev, curr);
  }
  static areOpposites(prev, curr) {
    return Math.abs(prev - curr) === 2;
  }
  static headingClockwise(prev, curr) {
    return (prev + 1) % 4 === curr;
  }
  static getAdjacentLocation(loc, isClockwise) {
    const delta = isClockwise ? 1 : 3;
    return (loc + delta) % 4;
  }
  static unlinkOp(op) {
    if (op.next === op) return null;
    op.prev.next = op.next;
    op.next.prev = op.prev;
    return op.next;
  }
  static unlinkOpBack(op) {
    if (op.next === op) return null;
    op.prev.next = op.next;
    op.next.prev = op.prev;
    return op.prev;
  }
  static getEdgesForPt(pt, rec) {
    let result = 0;
    if (pt.x === rec.left) result = 1;
    else if (pt.x === rec.right) result = 4;
    if (pt.y === rec.top) result += 2;
    else if (pt.y === rec.bottom) result += 8;
    return result;
  }
  static isHeadingClockwise(pt1, pt2, edgeIdx) {
    switch (edgeIdx) {
      case 0:
        return pt2.y < pt1.y;
      case 1:
        return pt2.x > pt1.x;
      case 2:
        return pt2.y > pt1.y;
      default:
        return pt2.x < pt1.x;
    }
  }
  static hasHorzOverlap(left1, right1, left2, right2) {
    return left1.x < right2.x && right1.x > left2.x;
  }
  static hasVertOverlap(top1, bottom1, top2, bottom2) {
    return top1.y < bottom2.y && bottom1.y > top2.y;
  }
  static addToEdge(edge, op) {
    if (op.edge !== null) return;
    op.edge = edge;
    edge.push(op);
  }
  static uncoupleEdge(op) {
    if (op.edge === null) return;
    for (let i = 0; i < op.edge.length; i++) {
      const op2 = op.edge[i];
      if (op2 === op) {
        op.edge[i] = null;
        break;
      }
    }
    op.edge = null;
  }
  static setNewOwner(op, newIdx) {
    op.ownerIdx = newIdx;
    let op2 = op.next;
    while (op2 !== op) {
      op2.ownerIdx = newIdx;
      op2 = op2.next;
    }
  }
  addCorner(prev, curr) {
    this.add(_RectClip64.headingClockwise(prev, curr) ? this.rectPath[prev] : this.rectPath[curr]);
  }
  addCornerWithDirection(loc, isClockwise) {
    if (isClockwise) {
      this.add(this.rectPath[loc]);
      return _RectClip64.getAdjacentLocation(loc, true);
    } else {
      const newLoc = _RectClip64.getAdjacentLocation(loc, false);
      this.add(this.rectPath[newLoc]);
      return newLoc;
    }
  }
  static getLocation(rec, pt) {
    if (pt.x === rec.left && pt.y >= rec.top && pt.y <= rec.bottom) {
      return { location: 0 /* left */, isOnRect: true };
    }
    if (pt.x === rec.right && pt.y >= rec.top && pt.y <= rec.bottom) {
      return { location: 2 /* right */, isOnRect: true };
    }
    if (pt.y === rec.top && pt.x >= rec.left && pt.x <= rec.right) {
      return { location: 1 /* top */, isOnRect: true };
    }
    if (pt.y === rec.bottom && pt.x >= rec.left && pt.x <= rec.right) {
      return { location: 3 /* bottom */, isOnRect: true };
    }
    let location;
    if (pt.x < rec.left) location = 0 /* left */;
    else if (pt.x > rec.right) location = 2 /* right */;
    else if (pt.y < rec.top) location = 1 /* top */;
    else if (pt.y > rec.bottom) location = 3 /* bottom */;
    else location = 4 /* inside */;
    return { location, isOnRect: false };
  }
  static isHorizontal(pt1, pt2) {
    return pt1.y === pt2.y;
  }
  static getSegmentIntersection(p1, p2, p3, p4) {
    const res1 = InternalClipper.crossProduct(p1, p3, p4);
    const res2 = InternalClipper.crossProduct(p2, p3, p4);
    if (res1 === 0) {
      const ip = p1;
      if (res2 === 0) return { intersects: false, point: ip };
      if (Point64Utils.equals(p1, p3) || Point64Utils.equals(p1, p4)) return { intersects: true, point: ip };
      if (_RectClip64.isHorizontal(p3, p4)) {
        return { intersects: p1.x > p3.x === p1.x < p4.x, point: ip };
      }
      return { intersects: p1.y > p3.y === p1.y < p4.y, point: ip };
    }
    if (res2 === 0) {
      const ip = p2;
      if (Point64Utils.equals(p2, p3) || Point64Utils.equals(p2, p4)) return { intersects: true, point: ip };
      if (_RectClip64.isHorizontal(p3, p4)) {
        return { intersects: p2.x > p3.x === p2.x < p4.x, point: ip };
      }
      return { intersects: p2.y > p3.y === p2.y < p4.y, point: ip };
    }
    if (res1 > 0 === res2 > 0) {
      return { intersects: false, point: { x: 0, y: 0 } };
    }
    const res3 = InternalClipper.crossProduct(p3, p1, p2);
    const res4 = InternalClipper.crossProduct(p4, p1, p2);
    if (res3 === 0) {
      const ip = p3;
      if (Point64Utils.equals(p3, p1) || Point64Utils.equals(p3, p2)) return { intersects: true, point: ip };
      if (_RectClip64.isHorizontal(p1, p2)) {
        return { intersects: p3.x > p1.x === p3.x < p2.x, point: ip };
      }
      return { intersects: p3.y > p1.y === p3.y < p2.y, point: ip };
    }
    if (res4 === 0) {
      const ip = p4;
      if (Point64Utils.equals(p4, p1) || Point64Utils.equals(p4, p2)) return { intersects: true, point: ip };
      if (_RectClip64.isHorizontal(p1, p2)) {
        return { intersects: p4.x > p1.x === p4.x < p2.x, point: ip };
      }
      return { intersects: p4.y > p1.y === p4.y < p2.y, point: ip };
    }
    if (res3 > 0 === res4 > 0) {
      return { intersects: false, point: { x: 0, y: 0 } };
    }
    return InternalClipper.getLineIntersectPt(p1, p2, p3, p4);
  }
  static getIntersection(rectPath, p, p2, loc) {
    let ip = { x: 0, y: 0 };
    let newLocation = loc;
    switch (loc) {
      case 0 /* left */: {
        const result1 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3]);
        if (result1.intersects) {
          ip = result1.point;
          return { intersects: true, point: ip, newLocation };
        }
        if (p.y < rectPath[0].y) {
          const result2 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1]);
          if (result2.intersects) {
            newLocation = 1 /* top */;
            return { intersects: true, point: result2.point, newLocation };
          }
        }
        const result3 = _RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3]);
        if (result3.intersects) {
          newLocation = 3 /* bottom */;
          return { intersects: true, point: result3.point, newLocation };
        }
        return { intersects: false, point: ip, newLocation };
      }
      case 2 /* right */: {
        const result1 = _RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2]);
        if (result1.intersects) {
          return { intersects: true, point: result1.point, newLocation };
        }
        if (p.y < rectPath[0].y) {
          const result2 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1]);
          if (result2.intersects) {
            newLocation = 1 /* top */;
            return { intersects: true, point: result2.point, newLocation };
          }
        }
        const result3 = _RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3]);
        if (result3.intersects) {
          newLocation = 3 /* bottom */;
          return { intersects: true, point: result3.point, newLocation };
        }
        return { intersects: false, point: ip, newLocation };
      }
      case 1 /* top */: {
        const result1 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1]);
        if (result1.intersects) {
          return { intersects: true, point: result1.point, newLocation };
        }
        if (p.x < rectPath[0].x) {
          const result2 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3]);
          if (result2.intersects) {
            newLocation = 0 /* left */;
            return { intersects: true, point: result2.point, newLocation };
          }
        }
        if (p.x <= rectPath[1].x) {
          return { intersects: false, point: ip, newLocation };
        }
        const result3 = _RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2]);
        if (result3.intersects) {
          newLocation = 2 /* right */;
          return { intersects: true, point: result3.point, newLocation };
        }
        return { intersects: false, point: ip, newLocation };
      }
      case 3 /* bottom */: {
        const result1 = _RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3]);
        if (result1.intersects) {
          return { intersects: true, point: result1.point, newLocation };
        }
        if (p.x < rectPath[3].x) {
          const result2 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3]);
          if (result2.intersects) {
            newLocation = 0 /* left */;
            return { intersects: true, point: result2.point, newLocation };
          }
        }
        if (p.x <= rectPath[2].x) {
          return { intersects: false, point: ip, newLocation };
        }
        const result3 = _RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2]);
        if (result3.intersects) {
          newLocation = 2 /* right */;
          return { intersects: true, point: result3.point, newLocation };
        }
        return { intersects: false, point: ip, newLocation };
      }
      default: {
        const result1 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3]);
        if (result1.intersects) {
          newLocation = 0 /* left */;
          return { intersects: true, point: result1.point, newLocation };
        }
        const result2 = _RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1]);
        if (result2.intersects) {
          newLocation = 1 /* top */;
          return { intersects: true, point: result2.point, newLocation };
        }
        const result3 = _RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2]);
        if (result3.intersects) {
          newLocation = 2 /* right */;
          return { intersects: true, point: result3.point, newLocation };
        }
        const result4 = _RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3]);
        if (result4.intersects) {
          newLocation = 3 /* bottom */;
          return { intersects: true, point: result4.point, newLocation };
        }
        return { intersects: false, point: ip, newLocation };
      }
    }
  }
  getNextLocation(path, loc, i, highI) {
    let newI = i;
    let newLoc = loc;
    switch (loc) {
      case 0 /* left */:
        while (newI <= highI && path[newI].x <= this.rect.left) newI++;
        if (newI > highI) break;
        if (path[newI].x >= this.rect.right) newLoc = 2 /* right */;
        else if (path[newI].y <= this.rect.top) newLoc = 1 /* top */;
        else if (path[newI].y >= this.rect.bottom) newLoc = 3 /* bottom */;
        else newLoc = 4 /* inside */;
        break;
      case 1 /* top */:
        while (newI <= highI && path[newI].y <= this.rect.top) newI++;
        if (newI > highI) break;
        if (path[newI].y >= this.rect.bottom) newLoc = 3 /* bottom */;
        else if (path[newI].x <= this.rect.left) newLoc = 0 /* left */;
        else if (path[newI].x >= this.rect.right) newLoc = 2 /* right */;
        else newLoc = 4 /* inside */;
        break;
      case 2 /* right */:
        while (newI <= highI && path[newI].x >= this.rect.right) newI++;
        if (newI > highI) break;
        if (path[newI].x <= this.rect.left) newLoc = 0 /* left */;
        else if (path[newI].y <= this.rect.top) newLoc = 1 /* top */;
        else if (path[newI].y >= this.rect.bottom) newLoc = 3 /* bottom */;
        else newLoc = 4 /* inside */;
        break;
      case 3 /* bottom */:
        while (newI <= highI && path[newI].y >= this.rect.bottom) newI++;
        if (newI > highI) break;
        if (path[newI].y <= this.rect.top) newLoc = 1 /* top */;
        else if (path[newI].x <= this.rect.left) newLoc = 0 /* left */;
        else if (path[newI].x >= this.rect.right) newLoc = 2 /* right */;
        else newLoc = 4 /* inside */;
        break;
      case 4 /* inside */:
        while (newI <= highI) {
          if (path[newI].x < this.rect.left) newLoc = 0 /* left */;
          else if (path[newI].x > this.rect.right) newLoc = 2 /* right */;
          else if (path[newI].y > this.rect.bottom) newLoc = 3 /* bottom */;
          else if (path[newI].y < this.rect.top) newLoc = 1 /* top */;
          else {
            this.add(path[newI]);
            newI++;
            continue;
          }
          break;
        }
        break;
    }
    return { location: newLoc, index: newI };
  }
  static startLocsAreClockwise(startLocs) {
    let result = 0;
    for (let i = 1; i < startLocs.length; i++) {
      const d = startLocs[i] - startLocs[i - 1];
      switch (d) {
        case -1:
          result -= 1;
          break;
        case 1:
          result += 1;
          break;
        case -3:
          result += 1;
          break;
        case 3:
          result -= 1;
          break;
      }
    }
    return result > 0;
  }
  executeInternal(path) {
    if (path.length < 3 || Rect64Utils.isEmpty(this.rect)) return;
    const startLocs = [];
    let firstCross = 4 /* inside */;
    let crossingLoc = firstCross;
    let prev = firstCross;
    const highI = path.length - 1;
    const lastLocResult = _RectClip64.getLocation(this.rect, path[highI]);
    let loc = lastLocResult.location;
    if (lastLocResult.isOnRect) {
      let i2 = highI - 1;
      while (i2 >= 0) {
        const prevLocResult = _RectClip64.getLocation(this.rect, path[i2]);
        if (!prevLocResult.isOnRect) {
          prev = prevLocResult.location;
          break;
        }
        i2--;
      }
      if (i2 < 0) {
        for (const pt of path) {
          this.add(pt);
        }
        return;
      }
      if (prev === 4 /* inside */) loc = 4 /* inside */;
    }
    const startingLoc = loc;
    let i = 0;
    while (i <= highI) {
      prev = loc;
      const prevCrossLoc = crossingLoc;
      const nextLocResult = this.getNextLocation(path, loc, i, highI);
      loc = nextLocResult.location;
      i = nextLocResult.index;
      if (i > highI) break;
      const prevPt = i === 0 ? path[highI] : path[i - 1];
      crossingLoc = loc;
      const intersectionResult = _RectClip64.getIntersection(this.rectPath, path[i], prevPt, crossingLoc);
      if (!intersectionResult.intersects) {
        if (prevCrossLoc === 4 /* inside */) {
          const isClockw = _RectClip64.isClockwise(prev, loc, prevPt, path[i], this.mp);
          do {
            startLocs.push(prev);
            prev = _RectClip64.getAdjacentLocation(prev, isClockw);
          } while (prev !== loc);
          crossingLoc = prevCrossLoc;
        } else if (prev !== 4 /* inside */ && prev !== loc) {
          const isClockw = _RectClip64.isClockwise(prev, loc, prevPt, path[i], this.mp);
          do {
            prev = this.addCornerWithDirection(prev, isClockw);
          } while (prev !== loc);
        }
        ++i;
        continue;
      }
      const ip = intersectionResult.point;
      crossingLoc = intersectionResult.newLocation;
      if (loc === 4 /* inside */) {
        if (firstCross === 4 /* inside */) {
          firstCross = crossingLoc;
          startLocs.push(prev);
        } else if (prev !== crossingLoc) {
          const isClockw = _RectClip64.isClockwise(prev, crossingLoc, prevPt, path[i], this.mp);
          do {
            prev = this.addCornerWithDirection(prev, isClockw);
          } while (prev !== crossingLoc);
        }
      } else if (prev !== 4 /* inside */) {
        loc = prev;
        const intersection2Result = _RectClip64.getIntersection(this.rectPath, prevPt, path[i], loc);
        const ip2 = intersection2Result.point;
        if (prevCrossLoc !== 4 /* inside */ && prevCrossLoc !== loc) {
          this.addCorner(prevCrossLoc, loc);
        }
        if (firstCross === 4 /* inside */) {
          firstCross = loc;
          startLocs.push(prev);
        }
        loc = crossingLoc;
        this.add(ip2);
        if (Point64Utils.equals(ip, ip2)) {
          const pathLocResult = _RectClip64.getLocation(this.rect, path[i]);
          loc = pathLocResult.location;
          this.addCorner(crossingLoc, loc);
          crossingLoc = loc;
          continue;
        }
      } else {
        loc = crossingLoc;
        if (firstCross === 4 /* inside */) {
          firstCross = crossingLoc;
        }
      }
      this.add(ip);
    }
    if (firstCross === 4 /* inside */) {
      if (startingLoc === 4 /* inside */) return;
      if (!Rect64Utils.containsRect(this.pathBounds, this.rect) || !_RectClip64.path1ContainsPath2(path, this.rectPath)) return;
      const startLocsClockwise = _RectClip64.startLocsAreClockwise(startLocs);
      for (let j = 0; j < 4; j++) {
        const k = startLocsClockwise ? j : 3 - j;
        this.add(this.rectPath[k]);
        _RectClip64.addToEdge(this.edges[k * 2], this.results[0]);
      }
    } else if (loc !== 4 /* inside */ && (loc !== firstCross || startLocs.length > 2)) {
      if (startLocs.length > 0) {
        prev = loc;
        for (const loc2 of startLocs) {
          if (prev === loc2) continue;
          prev = this.addCornerWithDirection(prev, _RectClip64.headingClockwise(prev, loc2));
          prev = loc2;
        }
        loc = prev;
      }
      if (loc !== firstCross) {
        this.addCornerWithDirection(loc, _RectClip64.headingClockwise(loc, firstCross));
      }
    }
  }
  execute(paths) {
    const result = [];
    if (Rect64Utils.isEmpty(this.rect)) return result;
    for (const path of paths) {
      if (path.length < 3) continue;
      this.pathBounds = InternalClipper.getBounds(path);
      if (!Rect64Utils.intersects(this.rect, this.pathBounds)) {
        continue;
      }
      if (Rect64Utils.containsRect(this.rect, this.pathBounds)) {
        result.push(path);
        continue;
      }
      this.executeInternal(path);
      this.checkEdges();
      for (let i = 0; i < 4; ++i) {
        this.tidyEdgePair(i, this.edges[i * 2], this.edges[i * 2 + 1]);
      }
      for (const op of this.results) {
        const tmp = this.getPath(op);
        if (tmp.length > 0) result.push(tmp);
      }
      this.results.length = 0;
      for (let i = 0; i < 8; i++) {
        this.edges[i].length = 0;
      }
    }
    return result;
  }
  checkEdges() {
    for (let i = 0; i < this.results.length; i++) {
      let op = this.results[i];
      let op2 = op;
      if (op === null) continue;
      do {
        if (InternalClipper.isCollinear(op2.prev.pt, op2.pt, op2.next.pt)) {
          if (op2 === op) {
            op2 = _RectClip64.unlinkOpBack(op2);
            if (op2 === null) break;
            op = op2.prev;
          } else {
            op2 = _RectClip64.unlinkOpBack(op2);
            if (op2 === null) break;
          }
        } else {
          op2 = op2.next;
        }
      } while (op2 !== op);
      if (op2 === null) {
        this.results[i] = null;
        continue;
      }
      this.results[i] = op2;
      let edgeSet1 = _RectClip64.getEdgesForPt(op.prev.pt, this.rect);
      op2 = op;
      do {
        const edgeSet2 = _RectClip64.getEdgesForPt(op2.pt, this.rect);
        if (edgeSet2 !== 0 && op2.edge === null) {
          const combinedSet = edgeSet1 & edgeSet2;
          for (let j = 0; j < 4; ++j) {
            if ((combinedSet & 1 << j) === 0) continue;
            if (_RectClip64.isHeadingClockwise(op2.prev.pt, op2.pt, j)) {
              _RectClip64.addToEdge(this.edges[j * 2], op2);
            } else {
              _RectClip64.addToEdge(this.edges[j * 2 + 1], op2);
            }
          }
        }
        edgeSet1 = edgeSet2;
        op2 = op2.next;
      } while (op2 !== op);
    }
  }
  tidyEdgePair(idx, cw, ccw) {
    if (ccw.length === 0) return;
    const isHorz = idx === 1 || idx === 3;
    const cwIsTowardLarger = idx === 1 || idx === 2;
    let i = 0, j = 0;
    while (i < cw.length) {
      let p1 = cw[i];
      if (p1 === null || p1.next === p1.prev) {
        cw[i++] = null;
        j = 0;
        continue;
      }
      const jLim = ccw.length;
      while (j < jLim && (ccw[j] === null || ccw[j].next === ccw[j].prev)) ++j;
      if (j === jLim) {
        ++i;
        j = 0;
        continue;
      }
      let p2;
      let p1a;
      let p2a;
      if (cwIsTowardLarger) {
        p1 = cw[i].prev;
        p1a = cw[i];
        p2 = ccw[j];
        p2a = ccw[j].prev;
      } else {
        p1 = cw[i];
        p1a = cw[i].prev;
        p2 = ccw[j].prev;
        p2a = ccw[j];
      }
      if (isHorz && !_RectClip64.hasHorzOverlap(p1.pt, p1a.pt, p2.pt, p2a.pt) || !isHorz && !_RectClip64.hasVertOverlap(p1.pt, p1a.pt, p2.pt, p2a.pt)) {
        ++j;
        continue;
      }
      const isRejoining = cw[i].ownerIdx !== ccw[j].ownerIdx;
      if (isRejoining) {
        this.results[p2.ownerIdx] = null;
        _RectClip64.setNewOwner(p2, p1.ownerIdx);
      }
      if (cwIsTowardLarger) {
        p1.next = p2;
        p2.prev = p1;
        p1a.prev = p2a;
        p2a.next = p1a;
      } else {
        p1.prev = p2;
        p2.next = p1;
        p1a.next = p2a;
        p2a.prev = p1a;
      }
      if (!isRejoining) {
        const newIdx = this.results.length;
        this.results.push(p1a);
        _RectClip64.setNewOwner(p1a, newIdx);
      }
      let op;
      let op2;
      if (cwIsTowardLarger) {
        op = p2;
        op2 = p1a;
      } else {
        op = p1;
        op2 = p2a;
      }
      this.results[op.ownerIdx] = op;
      this.results[op2.ownerIdx] = op2;
      let opIsLarger, op2IsLarger;
      if (isHorz) {
        opIsLarger = op.pt.x > op.prev.pt.x;
        op2IsLarger = op2.pt.x > op2.prev.pt.x;
      } else {
        opIsLarger = op.pt.y > op.prev.pt.y;
        op2IsLarger = op2.pt.y > op2.prev.pt.y;
      }
      if (op.next === op.prev || Point64Utils.equals(op.pt, op.prev.pt)) {
        if (op2IsLarger === cwIsTowardLarger) {
          cw[i] = op2;
          ccw[j++] = null;
        } else {
          ccw[j] = op2;
          cw[i++] = null;
        }
      } else if (op2.next === op2.prev || Point64Utils.equals(op2.pt, op2.prev.pt)) {
        if (opIsLarger === cwIsTowardLarger) {
          cw[i] = op;
          ccw[j++] = null;
        } else {
          ccw[j] = op;
          cw[i++] = null;
        }
      } else if (opIsLarger === op2IsLarger) {
        if (opIsLarger === cwIsTowardLarger) {
          cw[i] = op;
          _RectClip64.uncoupleEdge(op2);
          _RectClip64.addToEdge(cw, op2);
          ccw[j++] = null;
        } else {
          cw[i++] = null;
          ccw[j] = op2;
          _RectClip64.uncoupleEdge(op);
          _RectClip64.addToEdge(ccw, op);
          j = 0;
        }
      } else {
        if (opIsLarger === cwIsTowardLarger) {
          cw[i] = op;
        } else {
          ccw[j] = op;
        }
        if (op2IsLarger === cwIsTowardLarger) {
          cw[i] = op2;
        } else {
          ccw[j] = op2;
        }
      }
    }
  }
  getPath(op) {
    const result = [];
    if (op === null || op.prev === op.next) return result;
    let op2 = op.next;
    while (op2 !== null && op2 !== op) {
      if (InternalClipper.isCollinear(op2.prev.pt, op2.pt, op2.next.pt)) {
        op = op2.prev;
        op2 = _RectClip64.unlinkOp(op2);
      } else {
        op2 = op2.next;
      }
    }
    if (op2 === null) return [];
    result.push(op.pt);
    op2 = op.next;
    while (op2 !== op) {
      result.push(op2.pt);
      op2 = op2.next;
    }
    return result;
  }
};
var RectClipLines64 = class extends RectClip64 {
  constructor(rect) {
    super(rect);
  }
  execute(paths) {
    const result = [];
    if (Rect64Utils.isEmpty(this.rect)) return result;
    for (const path of paths) {
      if (path.length < 2) continue;
      this.pathBounds = InternalClipper.getBounds(path);
      if (!Rect64Utils.intersects(this.rect, this.pathBounds)) {
        continue;
      }
      this.executeInternalLines(path);
      for (const op of this.results) {
        const tmp = this.getPathLines(op);
        if (tmp.length > 0) result.push(tmp);
      }
      this.results.length = 0;
      for (let i = 0; i < 8; i++) {
        this.edges[i].length = 0;
      }
    }
    return result;
  }
  getPathLines(op) {
    const result = [];
    if (op === null || op === op.next) return result;
    op = op.next;
    result.push(op.pt);
    let op2 = op.next;
    while (op2 !== op) {
      result.push(op2.pt);
      op2 = op2.next;
    }
    return result;
  }
  executeInternalLines(path) {
    this.results.length = 0;
    if (path.length < 2 || Rect64Utils.isEmpty(this.rect)) return;
    let prev = 4 /* inside */;
    let i = 1;
    const highI = path.length - 1;
    const firstLocResult = RectClip64.getLocation(this.rect, path[0]);
    let loc = firstLocResult.location;
    if (firstLocResult.isOnRect) {
      while (i <= highI) {
        const prevLocResult = RectClip64.getLocation(this.rect, path[i]);
        if (!prevLocResult.isOnRect) {
          prev = prevLocResult.location;
          break;
        }
        i++;
      }
      if (i > highI) {
        for (const pt of path) {
          this.add(pt);
        }
        return;
      }
      if (prev === 4 /* inside */) loc = 4 /* inside */;
      i = 1;
    }
    if (loc === 4 /* inside */) this.add(path[0]);
    while (i <= highI) {
      prev = loc;
      const nextLocResult = this.getNextLocation(path, loc, i, highI);
      loc = nextLocResult.location;
      i = nextLocResult.index;
      if (i > highI) break;
      const prevPt = path[i - 1];
      let crossingLoc = loc;
      const intersectionResult = RectClip64.getIntersection(this.rectPath, path[i], prevPt, crossingLoc);
      if (!intersectionResult.intersects) {
        ++i;
        continue;
      }
      const ip = intersectionResult.point;
      crossingLoc = intersectionResult.newLocation;
      if (loc === 4 /* inside */) {
        this.add(ip, true);
      } else if (prev !== 4 /* inside */) {
        crossingLoc = prev;
        const intersection2Result = RectClip64.getIntersection(this.rectPath, prevPt, path[i], crossingLoc);
        const ip2 = intersection2Result.point;
        this.add(ip2, true);
        this.add(ip);
      } else {
        this.add(ip);
      }
    }
  }
};

// pkg/package/src/Minkowski.ts
var Minkowski;
((Minkowski2) => {
  function minkowskiInternal(pattern, path, isSum, isClosed) {
    const delta = isClosed ? 0 : 1;
    const patLen = pattern.length;
    const pathLen = path.length;
    const tmp = [];
    for (const pathPt of path) {
      const path2 = [];
      if (isSum) {
        for (const basePt of pattern) {
          path2.push(Point64Utils.add(pathPt, basePt));
        }
      } else {
        for (const basePt of pattern) {
          path2.push(Point64Utils.subtract(pathPt, basePt));
        }
      }
      tmp.push(path2);
    }
    const result = [];
    let g = isClosed ? pathLen - 1 : 0;
    let h = patLen - 1;
    for (let i = delta; i < pathLen; i++) {
      for (let j = 0; j < patLen; j++) {
        const quad = [
          tmp[g][h],
          tmp[i][h],
          tmp[i][j],
          tmp[g][j]
        ];
        if (!isPositive2(quad)) {
          result.push(reversePath2(quad));
        } else {
          result.push(quad);
        }
        h = j;
      }
      g = i;
    }
    return result;
  }
  function sum(pattern, path, isClosed) {
    return union2(minkowskiInternal(pattern, path, true, isClosed), 1 /* NonZero */);
  }
  Minkowski2.sum = sum;
  function sumD(pattern, path, isClosed, decimalPlaces = 2) {
    const scale = Math.pow(10, decimalPlaces);
    const tmp = union2(
      minkowskiInternal(
        scalePath642(pattern, scale),
        scalePath642(path, scale),
        true,
        isClosed
      ),
      1 /* NonZero */
    );
    return scalePathsD2(tmp, 1 / scale);
  }
  Minkowski2.sumD = sumD;
  function diff(pattern, path, isClosed) {
    return union2(minkowskiInternal(pattern, path, false, isClosed), 1 /* NonZero */);
  }
  Minkowski2.diff = diff;
  function diffD(pattern, path, isClosed, decimalPlaces = 2) {
    const scale = Math.pow(10, decimalPlaces);
    const tmp = union2(
      minkowskiInternal(
        scalePath642(pattern, scale),
        scalePath642(path, scale),
        false,
        isClosed
      ),
      1 /* NonZero */
    );
    return scalePathsD2(tmp, 1 / scale);
  }
  Minkowski2.diffD = diffD;
  function isPositive2(path) {
    return area2(path) >= 0;
  }
  function area2(path) {
    let a = 0;
    const cnt = path.length;
    if (cnt < 3) return 0;
    let prevPt = path[cnt - 1];
    for (const pt of path) {
      a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
      prevPt = pt;
    }
    return a * 0.5;
  }
  function reversePath2(path) {
    return [...path].reverse();
  }
  function scalePath642(path, scale) {
    const result = [];
    for (const pt of path) {
      result.push({
        x: InternalClipper.roundToEven(pt.x * scale),
        y: InternalClipper.roundToEven(pt.y * scale)
      });
    }
    return result;
  }
  function scalePathsD2(paths, scale) {
    const result = [];
    for (const path of paths) {
      const pathD = [];
      for (const pt of path) {
        pathD.push({
          x: pt.x * scale,
          y: pt.y * scale
        });
      }
      result.push(pathD);
    }
    return result;
  }
  function union2(paths, fillRule) {
    const solution = [];
    const c = new Clipper64();
    c.addPaths(paths, 0 /* Subject */);
    c.execute(2 /* Union */, fillRule, solution);
    return solution;
  }
})(Minkowski || (Minkowski = {}));

// pkg/package/src/Clipper.ts
var Clipper2;
((Clipper3) => {
  Clipper3.invalidRect64 = InvalidRect64;
  Clipper3.invalidRectD = InvalidRectD;
  function intersect2(subject, clip, fillRule) {
    return booleanOp2(1 /* Intersection */, subject, clip, fillRule);
  }
  Clipper3.intersect = intersect2;
  function intersectD2(subject, clip, fillRule, precision = 2) {
    return booleanOpD2(1 /* Intersection */, subject, clip, fillRule, precision);
  }
  Clipper3.intersectD = intersectD2;
  function union2(subject, clipOrFillRule, fillRule) {
    if (typeof clipOrFillRule === "number") {
      return booleanOp2(2 /* Union */, subject, null, clipOrFillRule);
    } else {
      return booleanOp2(2 /* Union */, subject, clipOrFillRule, fillRule);
    }
  }
  Clipper3.union = union2;
  function unionD2(subject, clipOrFillRule, fillRuleOrPrecision, precision) {
    if (typeof clipOrFillRule === "number") {
      return booleanOpD2(2 /* Union */, subject, null, clipOrFillRule);
    } else {
      return booleanOpD2(2 /* Union */, subject, clipOrFillRule, fillRuleOrPrecision, precision || 2);
    }
  }
  Clipper3.unionD = unionD2;
  function difference2(subject, clip, fillRule) {
    return booleanOp2(3 /* Difference */, subject, clip, fillRule);
  }
  Clipper3.difference = difference2;
  function differenceD2(subject, clip, fillRule, precision = 2) {
    return booleanOpD2(3 /* Difference */, subject, clip, fillRule, precision);
  }
  Clipper3.differenceD = differenceD2;
  function xor2(subject, clip, fillRule) {
    return booleanOp2(4 /* Xor */, subject, clip, fillRule);
  }
  Clipper3.xor = xor2;
  function xorD2(subject, clip, fillRule, precision = 2) {
    return booleanOpD2(4 /* Xor */, subject, clip, fillRule, precision);
  }
  Clipper3.xorD = xorD2;
  function booleanOp2(clipType, subject, clip, fillRule) {
    const solution = [];
    if (subject === null) return solution;
    const c = new Clipper64();
    c.addPaths(subject, 0 /* Subject */);
    if (clip !== null) {
      c.addPaths(clip, 1 /* Clip */);
    }
    c.execute(clipType, fillRule, solution);
    return solution;
  }
  Clipper3.booleanOp = booleanOp2;
  function booleanOpWithPolyTree2(clipType, subject, clip, polytree, fillRule) {
    if (subject === null) return;
    const c = new Clipper64();
    c.addPaths(subject, 0 /* Subject */);
    if (clip !== null) {
      c.addPaths(clip, 1 /* Clip */);
    }
    c.execute(clipType, fillRule, polytree);
  }
  Clipper3.booleanOpWithPolyTree = booleanOpWithPolyTree2;
  function booleanOpD2(clipType, subject, clip, fillRule, precision = 2) {
    const solution = [];
    const c = new ClipperD(precision);
    c.addSubjectPaths(subject);
    if (clip !== null) {
      c.addClipPaths(clip);
    }
    c.execute(clipType, fillRule, solution);
    return solution;
  }
  Clipper3.booleanOpD = booleanOpD2;
  function booleanOpDWithPolyTree2(clipType, subject, clip, polytree, fillRule, precision = 2) {
    if (subject === null) return;
    const c = new ClipperD(precision);
    c.addSubjectPaths(subject);
    if (clip !== null) {
      c.addClipPaths(clip);
    }
    c.execute(clipType, fillRule, polytree);
  }
  Clipper3.booleanOpDWithPolyTree = booleanOpDWithPolyTree2;
  function inflatePaths2(paths, delta, joinType, endType, miterLimit = 2, arcTolerance = 0) {
    const co = new ClipperOffset(miterLimit, arcTolerance);
    co.addPaths(paths, joinType, endType);
    const solution = [];
    co.execute(delta, solution);
    return solution;
  }
  Clipper3.inflatePaths = inflatePaths2;
  function inflatePathsD2(paths, delta, joinType, endType, miterLimit = 2, precision = 2, arcTolerance = 0) {
    InternalClipper.checkPrecision(precision);
    const scale = Math.pow(10, precision);
    const tmp = scalePaths642(paths, scale);
    const co = new ClipperOffset(miterLimit, scale * arcTolerance);
    co.addPaths(tmp, joinType, endType);
    const solution = [];
    co.execute(delta * scale, solution);
    return scalePathsD2(solution, 1 / scale);
  }
  Clipper3.inflatePathsD = inflatePathsD2;
  function rectClip2(rect, pathsOrPath, precision) {
    if ("left" in rect && typeof rect.left === "number" && Number.isInteger(rect.left)) {
      const rect64 = rect;
      if (Rect64Utils.isEmpty(rect64)) return [];
      if (Array.isArray(pathsOrPath[0])) {
        const paths = pathsOrPath;
        if (paths.length === 0) return [];
        const rc = new RectClip64(rect64);
        return rc.execute(paths);
      } else {
        const path = pathsOrPath;
        if (path.length === 0) return [];
        const tmp = [path];
        return rectClip2(rect64, tmp);
      }
    } else {
      const rectD = rect;
      const prec = precision || 2;
      InternalClipper.checkPrecision(prec);
      if (RectDUtils.isEmpty(rectD)) return [];
      const scale = Math.pow(10, prec);
      const r = scaleRect(rectD, scale);
      if (Array.isArray(pathsOrPath[0])) {
        const paths = pathsOrPath;
        if (paths.length === 0) return [];
        const tmpPath = scalePaths642(paths, scale);
        const rc = new RectClip64(r);
        const result = rc.execute(tmpPath);
        return scalePathsD2(result, 1 / scale);
      } else {
        const path = pathsOrPath;
        if (path.length === 0) return [];
        const tmp = [path];
        return rectClip2(rectD, tmp, prec);
      }
    }
  }
  Clipper3.rectClip = rectClip2;
  function rectClipLines2(rect, pathsOrPath, precision) {
    if ("left" in rect && typeof rect.left === "number" && Number.isInteger(rect.left)) {
      const rect64 = rect;
      if (Rect64Utils.isEmpty(rect64)) return [];
      if (Array.isArray(pathsOrPath[0])) {
        const paths = pathsOrPath;
        if (paths.length === 0) return [];
        const rc = new RectClipLines64(rect64);
        return rc.execute(paths);
      } else {
        const path = pathsOrPath;
        if (path.length === 0) return [];
        const tmp = [path];
        return rectClipLines2(rect64, tmp);
      }
    } else {
      const rectD = rect;
      const prec = precision || 2;
      InternalClipper.checkPrecision(prec);
      if (RectDUtils.isEmpty(rectD)) return [];
      const scale = Math.pow(10, prec);
      const r = scaleRect(rectD, scale);
      if (Array.isArray(pathsOrPath[0])) {
        const paths = pathsOrPath;
        if (paths.length === 0) return [];
        const tmpPath = scalePaths642(paths, scale);
        const rc = new RectClipLines64(r);
        const result = rc.execute(tmpPath);
        return scalePathsD2(result, 1 / scale);
      } else {
        const path = pathsOrPath;
        if (path.length === 0) return [];
        const tmp = [path];
        return rectClipLines2(rectD, tmp, prec);
      }
    }
  }
  Clipper3.rectClipLines = rectClipLines2;
  function minkowskiSum2(pattern, path, isClosed) {
    return Minkowski.sum(pattern, path, isClosed);
  }
  Clipper3.minkowskiSum = minkowskiSum2;
  function minkowskiSumD2(pattern, path, isClosed) {
    return Minkowski.sumD(pattern, path, isClosed);
  }
  Clipper3.minkowskiSumD = minkowskiSumD2;
  function minkowskiDiff2(pattern, path, isClosed) {
    return Minkowski.diff(pattern, path, isClosed);
  }
  Clipper3.minkowskiDiff = minkowskiDiff2;
  function minkowskiDiffD2(pattern, path, isClosed) {
    return Minkowski.diffD(pattern, path, isClosed);
  }
  Clipper3.minkowskiDiffD = minkowskiDiffD2;
  function area2(path) {
    let a = 0;
    const cnt = path.length;
    if (cnt < 3) return 0;
    let prevPt = path[cnt - 1];
    for (const pt of path) {
      a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
      prevPt = pt;
    }
    return a * 0.5;
  }
  Clipper3.area = area2;
  function areaPaths2(paths) {
    let a = 0;
    for (const path of paths) {
      a += area2(path);
    }
    return a;
  }
  Clipper3.areaPaths = areaPaths2;
  function areaD2(path) {
    let a = 0;
    const cnt = path.length;
    if (cnt < 3) return 0;
    let prevPt = path[cnt - 1];
    for (const pt of path) {
      a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
      prevPt = pt;
    }
    return a * 0.5;
  }
  Clipper3.areaD = areaD2;
  function areaPathsD2(paths) {
    let a = 0;
    for (const path of paths) {
      a += areaD2(path);
    }
    return a;
  }
  Clipper3.areaPathsD = areaPathsD2;
  function isPositive2(poly) {
    return area2(poly) >= 0;
  }
  Clipper3.isPositive = isPositive2;
  function isPositiveD2(poly) {
    return areaD2(poly) >= 0;
  }
  Clipper3.isPositiveD = isPositiveD2;
  function path64ToString(path) {
    let result = "";
    for (const pt of path) {
      result += Point64Utils.toString(pt);
    }
    return result + "\n";
  }
  Clipper3.path64ToString = path64ToString;
  function paths64ToString(paths) {
    let result = "";
    for (const path of paths) {
      result += path64ToString(path);
    }
    return result;
  }
  Clipper3.paths64ToString = paths64ToString;
  function pathDToString(path, precision = 2) {
    let result = "";
    for (const pt of path) {
      result += PointDUtils.toString(pt, precision);
    }
    return result + "\n";
  }
  Clipper3.pathDToString = pathDToString;
  function pathsDToString(paths, precision = 2) {
    let result = "";
    for (const path of paths) {
      result += pathDToString(path, precision);
    }
    return result;
  }
  Clipper3.pathsDToString = pathsDToString;
  function offsetPath(path, dx, dy) {
    const result = [];
    for (const pt of path) {
      result.push({ x: pt.x + dx, y: pt.y + dy });
    }
    return result;
  }
  Clipper3.offsetPath = offsetPath;
  function scalePoint64(pt, scale) {
    return {
      x: Math.round(pt.x * scale),
      y: Math.round(pt.y * scale)
    };
  }
  Clipper3.scalePoint64 = scalePoint64;
  function scalePointD(pt, scale) {
    return {
      x: pt.x * scale,
      y: pt.y * scale
    };
  }
  Clipper3.scalePointD = scalePointD;
  function scaleRect(rec, scale) {
    return {
      left: Math.round(rec.left * scale),
      top: Math.round(rec.top * scale),
      right: Math.round(rec.right * scale),
      bottom: Math.round(rec.bottom * scale)
    };
  }
  Clipper3.scaleRect = scaleRect;
  function scalePath(path, scale) {
    if (InternalClipper.isAlmostZero(scale - 1)) return path;
    const result = [];
    for (const pt of path) {
      result.push({
        x: Math.round(pt.x * scale),
        y: Math.round(pt.y * scale)
      });
    }
    return result;
  }
  Clipper3.scalePath = scalePath;
  function scalePaths(paths, scale) {
    if (InternalClipper.isAlmostZero(scale - 1)) return paths;
    const result = [];
    for (const path of paths) {
      result.push(scalePath(path, scale));
    }
    return result;
  }
  Clipper3.scalePaths = scalePaths;
  function scalePathD2(path, scale) {
    if (InternalClipper.isAlmostZero(scale - 1)) return path;
    const result = [];
    for (const pt of path) {
      result.push(PointDUtils.scale(pt, scale));
    }
    return result;
  }
  Clipper3.scalePathD = scalePathD2;
  function scalePathsD2(paths, scale) {
    if (InternalClipper.isAlmostZero(scale - 1)) return paths;
    const result = [];
    for (const path of paths) {
      result.push(scalePathD2(path, scale));
    }
    return result;
  }
  Clipper3.scalePathsD = scalePathsD2;
  function scalePath642(path, scale) {
    const result = [];
    for (const pt of path) {
      result.push({
        x: Math.round(pt.x * scale),
        y: Math.round(pt.y * scale)
      });
    }
    return result;
  }
  Clipper3.scalePath64 = scalePath642;
  function scalePaths642(paths, scale) {
    const result = [];
    for (const path of paths) {
      result.push(scalePath642(path, scale));
    }
    return result;
  }
  Clipper3.scalePaths64 = scalePaths642;
  function scalePathDFromInt(path, scale) {
    const result = [];
    for (const pt of path) {
      result.push({
        x: pt.x * scale,
        y: pt.y * scale
      });
    }
    return result;
  }
  Clipper3.scalePathDFromInt = scalePathDFromInt;
  function scalePathsDFromInt(paths, scale) {
    const result = [];
    for (const path of paths) {
      result.push(scalePathDFromInt(path, scale));
    }
    return result;
  }
  Clipper3.scalePathsDFromInt = scalePathsDFromInt;
  function path64FromD(path) {
    const result = [];
    for (const pt of path) {
      result.push(Point64Utils.fromPointD(pt));
    }
    return result;
  }
  Clipper3.path64FromD = path64FromD;
  function paths64FromD(paths) {
    const result = [];
    for (const path of paths) {
      result.push(path64FromD(path));
    }
    return result;
  }
  Clipper3.paths64FromD = paths64FromD;
  function pathsD(paths) {
    const result = [];
    for (const path of paths) {
      result.push(pathD(path));
    }
    return result;
  }
  Clipper3.pathsD = pathsD;
  function pathD(path) {
    const result = [];
    for (const pt of path) {
      result.push(PointDUtils.fromPoint64(pt));
    }
    return result;
  }
  Clipper3.pathD = pathD;
  function translatePath2(path, dx, dy) {
    const result = [];
    for (const pt of path) {
      result.push({ x: pt.x + dx, y: pt.y + dy });
    }
    return result;
  }
  Clipper3.translatePath = translatePath2;
  function translatePaths2(paths, dx, dy) {
    const result = [];
    for (const path of paths) {
      result.push(offsetPath(path, dx, dy));
    }
    return result;
  }
  Clipper3.translatePaths = translatePaths2;
  function translatePathD2(path, dx, dy) {
    const result = [];
    for (const pt of path) {
      result.push({ x: pt.x + dx, y: pt.y + dy });
    }
    return result;
  }
  Clipper3.translatePathD = translatePathD2;
  function translatePathsD2(paths, dx, dy) {
    const result = [];
    for (const path of paths) {
      result.push(translatePathD2(path, dx, dy));
    }
    return result;
  }
  Clipper3.translatePathsD = translatePathsD2;
  function reversePath2(path) {
    return [...path].reverse();
  }
  Clipper3.reversePath = reversePath2;
  function reversePathD2(path) {
    return [...path].reverse();
  }
  Clipper3.reversePathD = reversePathD2;
  function reversePaths2(paths) {
    const result = [];
    for (const path of paths) {
      result.push(reversePath2(path));
    }
    return result;
  }
  Clipper3.reversePaths = reversePaths2;
  function reversePathsD2(paths) {
    const result = [];
    for (const path of paths) {
      result.push(reversePathD2(path));
    }
    return result;
  }
  Clipper3.reversePathsD = reversePathsD2;
  function getBounds2(path) {
    return InternalClipper.getBounds(path);
  }
  Clipper3.getBounds = getBounds2;
  function getBoundsPaths2(paths) {
    const result = Rect64Utils.createInvalid();
    for (const path of paths) {
      for (const pt of path) {
        if (pt.x < result.left) result.left = pt.x;
        if (pt.x > result.right) result.right = pt.x;
        if (pt.y < result.top) result.top = pt.y;
        if (pt.y > result.bottom) result.bottom = pt.y;
      }
    }
    return result.left === Number.MAX_SAFE_INTEGER ? { left: 0, top: 0, right: 0, bottom: 0 } : result;
  }
  Clipper3.getBoundsPaths = getBoundsPaths2;
  function getBoundsD2(path) {
    const result = RectDUtils.createInvalid();
    for (const pt of path) {
      if (pt.x < result.left) result.left = pt.x;
      if (pt.x > result.right) result.right = pt.x;
      if (pt.y < result.top) result.top = pt.y;
      if (pt.y > result.bottom) result.bottom = pt.y;
    }
    return Math.abs(result.left - Number.MAX_VALUE) < InternalClipper.floatingPointTolerance ? { left: 0, top: 0, right: 0, bottom: 0 } : result;
  }
  Clipper3.getBoundsD = getBoundsD2;
  function getBoundsPathsD2(paths) {
    const result = RectDUtils.createInvalid();
    for (const path of paths) {
      for (const pt of path) {
        if (pt.x < result.left) result.left = pt.x;
        if (pt.x > result.right) result.right = pt.x;
        if (pt.y < result.top) result.top = pt.y;
        if (pt.y > result.bottom) result.bottom = pt.y;
      }
    }
    return Math.abs(result.left - Number.MAX_VALUE) < InternalClipper.floatingPointTolerance ? { left: 0, top: 0, right: 0, bottom: 0 } : result;
  }
  Clipper3.getBoundsPathsD = getBoundsPathsD2;
  function makePath2(arr) {
    const len = Math.floor(arr.length / 2);
    const p = [];
    for (let i = 0; i < len; i++) {
      p.push({ x: arr[i * 2], y: arr[i * 2 + 1] });
    }
    return p;
  }
  Clipper3.makePath = makePath2;
  function makePathD2(arr) {
    const len = Math.floor(arr.length / 2);
    const p = [];
    for (let i = 0; i < len; i++) {
      p.push({ x: arr[i * 2], y: arr[i * 2 + 1] });
    }
    return p;
  }
  Clipper3.makePathD = makePathD2;
  function sqr(val) {
    return val * val;
  }
  Clipper3.sqr = sqr;
  function distanceSqr(pt1, pt2) {
    return sqr(pt1.x - pt2.x) + sqr(pt1.y - pt2.y);
  }
  Clipper3.distanceSqr = distanceSqr;
  function midPoint(pt1, pt2) {
    return { x: Math.round((pt1.x + pt2.x) / 2), y: Math.round((pt1.y + pt2.y) / 2) };
  }
  Clipper3.midPoint = midPoint;
  function midPointD(pt1, pt2) {
    return { x: (pt1.x + pt2.x) / 2, y: (pt1.y + pt2.y) / 2 };
  }
  Clipper3.midPointD = midPointD;
  function inflateRect(rec, dx, dy) {
    rec.left -= dx;
    rec.right += dx;
    rec.top -= dy;
    rec.bottom += dy;
  }
  Clipper3.inflateRect = inflateRect;
  function inflateRectD(rec, dx, dy) {
    rec.left -= dx;
    rec.right += dx;
    rec.top -= dy;
    rec.bottom += dy;
  }
  Clipper3.inflateRectD = inflateRectD;
  function pointsNearEqual(pt1, pt2, distanceSqrd) {
    return sqr(pt1.x - pt2.x) + sqr(pt1.y - pt2.y) < distanceSqrd;
  }
  Clipper3.pointsNearEqual = pointsNearEqual;
  function stripNearDuplicates(path, minEdgeLenSqrd, isClosedPath) {
    const cnt = path.length;
    const result = [];
    if (cnt === 0) return result;
    let lastPt = path[0];
    result.push(lastPt);
    for (let i = 1; i < cnt; i++) {
      if (!pointsNearEqual(lastPt, path[i], minEdgeLenSqrd)) {
        lastPt = path[i];
        result.push(lastPt);
      }
    }
    if (isClosedPath && pointsNearEqual(lastPt, result[0], minEdgeLenSqrd)) {
      result.pop();
    }
    return result;
  }
  Clipper3.stripNearDuplicates = stripNearDuplicates;
  function stripDuplicates2(path, isClosedPath) {
    const cnt = path.length;
    const result = [];
    if (cnt === 0) return result;
    let lastPt = path[0];
    result.push(lastPt);
    for (let i = 1; i < cnt; i++) {
      if (!Point64Utils.equals(lastPt, path[i])) {
        lastPt = path[i];
        result.push(lastPt);
      }
    }
    if (isClosedPath && Point64Utils.equals(lastPt, result[0])) {
      result.pop();
    }
    return result;
  }
  Clipper3.stripDuplicates = stripDuplicates2;
  function addPolyNodeToPaths(polyPath, paths) {
    if (polyPath.poly && polyPath.poly.length > 0) {
      paths.push(polyPath.poly);
    }
    for (let i = 0; i < polyPath.count; i++) {
      addPolyNodeToPaths(polyPath.child(i), paths);
    }
  }
  function polyTreeToPaths64(polyTree) {
    const result = [];
    for (let i = 0; i < polyTree.count; i++) {
      addPolyNodeToPaths(polyTree.child(i), result);
    }
    return result;
  }
  Clipper3.polyTreeToPaths64 = polyTreeToPaths64;
  function addPolyNodeToPathsD(polyPath, paths) {
    if (polyPath.poly && polyPath.poly.length > 0) {
      paths.push(polyPath.poly);
    }
    for (let i = 0; i < polyPath.count; i++) {
      addPolyNodeToPathsD(polyPath.child(i), paths);
    }
  }
  Clipper3.addPolyNodeToPathsD = addPolyNodeToPathsD;
  function polyTreeToPathsD(polyTree) {
    const result = [];
    for (let i = 0; i < polyTree.count; i++) {
      addPolyNodeToPathsD(polyTree.child(i), result);
    }
    return result;
  }
  Clipper3.polyTreeToPathsD = polyTreeToPathsD;
  function perpendicDistFromLineSqrd(pt, line1, line2) {
    const a = pt.x - line1.x;
    const b = pt.y - line1.y;
    const c = line2.x - line1.x;
    const d = line2.y - line1.y;
    if (c === 0 && d === 0) return 0;
    return sqr(a * d - c * b) / (c * c + d * d);
  }
  Clipper3.perpendicDistFromLineSqrd = perpendicDistFromLineSqrd;
  function perpendicDistFromLineSqrd64(pt, line1, line2) {
    const a = pt.x - line1.x;
    const b = pt.y - line1.y;
    const c = line2.x - line1.x;
    const d = line2.y - line1.y;
    if (c === 0 && d === 0) return 0;
    return sqr(a * d - c * b) / (c * c + d * d);
  }
  Clipper3.perpendicDistFromLineSqrd64 = perpendicDistFromLineSqrd64;
  function rdp(path, begin, end, epsSqrd, flags) {
    while (true) {
      let idx = 0;
      let maxD = 0;
      while (end > begin && Point64Utils.equals(path[begin], path[end])) flags[end--] = false;
      for (let i = begin + 1; i < end; ++i) {
        const d = perpendicDistFromLineSqrd64(path[i], path[begin], path[end]);
        if (d <= maxD) continue;
        maxD = d;
        idx = i;
      }
      if (maxD <= epsSqrd) return;
      flags[idx] = true;
      if (idx > begin + 1) rdp(path, begin, idx, epsSqrd, flags);
      if (idx < end - 1) {
        begin = idx;
        continue;
      }
      break;
    }
  }
  function ramerDouglasPeucker2(path, epsilon) {
    const len = path.length;
    if (len < 5) return path;
    const flags = new Array(len).fill(false);
    flags[0] = true;
    flags[len - 1] = true;
    rdp(path, 0, len - 1, sqr(epsilon), flags);
    const result = [];
    for (let i = 0; i < len; ++i) {
      if (flags[i]) result.push(path[i]);
    }
    return result;
  }
  Clipper3.ramerDouglasPeucker = ramerDouglasPeucker2;
  function ramerDouglasPeuckerPaths2(paths, epsilon) {
    const result = [];
    for (const path of paths) {
      result.push(ramerDouglasPeucker2(path, epsilon));
    }
    return result;
  }
  Clipper3.ramerDouglasPeuckerPaths = ramerDouglasPeuckerPaths2;
  function rdpD(path, begin, end, epsSqrd, flags) {
    while (true) {
      let idx = 0;
      let maxD = 0;
      while (end > begin && PointDUtils.equals(path[begin], path[end])) flags[end--] = false;
      for (let i = begin + 1; i < end; ++i) {
        const d = perpendicDistFromLineSqrd(path[i], path[begin], path[end]);
        if (d <= maxD) continue;
        maxD = d;
        idx = i;
      }
      if (maxD <= epsSqrd) return;
      flags[idx] = true;
      if (idx > begin + 1) rdpD(path, begin, idx, epsSqrd, flags);
      if (idx < end - 1) {
        begin = idx;
        continue;
      }
      break;
    }
  }
  function ramerDouglasPeuckerD2(path, epsilon) {
    const len = path.length;
    if (len < 5) return path;
    const flags = new Array(len).fill(false);
    flags[0] = true;
    flags[len - 1] = true;
    rdpD(path, 0, len - 1, sqr(epsilon), flags);
    const result = [];
    for (let i = 0; i < len; ++i) {
      if (flags[i]) result.push(path[i]);
    }
    return result;
  }
  Clipper3.ramerDouglasPeuckerD = ramerDouglasPeuckerD2;
  function ramerDouglasPeuckerPathsD2(paths, epsilon) {
    const result = [];
    for (const path of paths) {
      result.push(ramerDouglasPeuckerD2(path, epsilon));
    }
    return result;
  }
  Clipper3.ramerDouglasPeuckerPathsD = ramerDouglasPeuckerPathsD2;
  function getNext(current, high, flags) {
    ++current;
    while (current <= high && flags[current]) ++current;
    if (current <= high) return current;
    current = 0;
    while (flags[current]) ++current;
    return current;
  }
  function getPrior(current, high, flags) {
    if (current === 0) current = high;
    else --current;
    while (current > 0 && flags[current]) --current;
    if (!flags[current]) return current;
    current = high;
    while (flags[current]) --current;
    return current;
  }
  function simplifyPath2(path, epsilon, isClosedPath = true) {
    const len = path.length;
    const high = len - 1;
    const epsSqr = sqr(epsilon);
    if (len < 4) return path;
    const flags = new Array(len).fill(false);
    const dsq = new Array(len).fill(0);
    let curr = 0;
    if (isClosedPath) {
      dsq[0] = perpendicDistFromLineSqrd64(path[0], path[high], path[1]);
      dsq[high] = perpendicDistFromLineSqrd64(path[high], path[0], path[high - 1]);
    } else {
      dsq[0] = Number.MAX_VALUE;
      dsq[high] = Number.MAX_VALUE;
    }
    for (let i = 1; i < high; ++i) {
      dsq[i] = perpendicDistFromLineSqrd64(path[i], path[i - 1], path[i + 1]);
    }
    while (true) {
      if (dsq[curr] > epsSqr) {
        const start = curr;
        do {
          curr = getNext(curr, high, flags);
        } while (curr !== start && dsq[curr] > epsSqr);
        if (curr === start) break;
      }
      const prev = getPrior(curr, high, flags);
      const next = getNext(curr, high, flags);
      if (next === prev) break;
      let prior2;
      if (dsq[next] < dsq[curr]) {
        prior2 = prev;
        const newPrev = curr;
        curr = next;
        const newNext = getNext(next, high, flags);
        flags[curr] = true;
        curr = newNext;
        const nextNext = getNext(newNext, high, flags);
        if (isClosedPath || curr !== high && curr !== 0) {
          dsq[curr] = perpendicDistFromLineSqrd64(path[curr], path[newPrev], path[nextNext]);
        }
        if (isClosedPath || newPrev !== 0 && newPrev !== high) {
          dsq[newPrev] = perpendicDistFromLineSqrd64(path[newPrev], path[prior2], path[curr]);
        }
      } else {
        prior2 = getPrior(prev, high, flags);
        flags[curr] = true;
        curr = next;
        const nextNext = getNext(next, high, flags);
        if (isClosedPath || curr !== high && curr !== 0) {
          dsq[curr] = perpendicDistFromLineSqrd64(path[curr], path[prev], path[nextNext]);
        }
        if (isClosedPath || prev !== 0 && prev !== high) {
          dsq[prev] = perpendicDistFromLineSqrd64(path[prev], path[prior2], path[curr]);
        }
      }
    }
    const result = [];
    for (let i = 0; i < len; i++) {
      if (!flags[i]) result.push(path[i]);
    }
    return result;
  }
  Clipper3.simplifyPath = simplifyPath2;
  function simplifyPaths2(paths, epsilon, isClosedPaths = true) {
    const result = [];
    for (const path of paths) {
      result.push(simplifyPath2(path, epsilon, isClosedPaths));
    }
    return result;
  }
  Clipper3.simplifyPaths = simplifyPaths2;
  function simplifyPathD2(path, epsilon, isClosedPath = true) {
    const len = path.length;
    const high = len - 1;
    const epsSqr = sqr(epsilon);
    if (len < 4) return path;
    const flags = new Array(len).fill(false);
    const dsq = new Array(len).fill(0);
    let curr = 0;
    if (isClosedPath) {
      dsq[0] = perpendicDistFromLineSqrd(path[0], path[high], path[1]);
      dsq[high] = perpendicDistFromLineSqrd(path[high], path[0], path[high - 1]);
    } else {
      dsq[0] = Number.MAX_VALUE;
      dsq[high] = Number.MAX_VALUE;
    }
    for (let i = 1; i < high; ++i) {
      dsq[i] = perpendicDistFromLineSqrd(path[i], path[i - 1], path[i + 1]);
    }
    while (true) {
      if (dsq[curr] > epsSqr) {
        const start = curr;
        do {
          curr = getNext(curr, high, flags);
        } while (curr !== start && dsq[curr] > epsSqr);
        if (curr === start) break;
      }
      const prev = getPrior(curr, high, flags);
      const next = getNext(curr, high, flags);
      if (next === prev) break;
      let prior2;
      if (dsq[next] < dsq[curr]) {
        prior2 = prev;
        const newPrev = curr;
        curr = next;
        const newNext = getNext(next, high, flags);
        flags[curr] = true;
        curr = newNext;
        const nextNext = getNext(newNext, high, flags);
        if (isClosedPath || curr !== high && curr !== 0) {
          dsq[curr] = perpendicDistFromLineSqrd(path[curr], path[newPrev], path[nextNext]);
        }
        if (isClosedPath || newPrev !== 0 && newPrev !== high) {
          dsq[newPrev] = perpendicDistFromLineSqrd(path[newPrev], path[prior2], path[curr]);
        }
      } else {
        prior2 = getPrior(prev, high, flags);
        flags[curr] = true;
        curr = next;
        const nextNext = getNext(next, high, flags);
        if (isClosedPath || curr !== high && curr !== 0) {
          dsq[curr] = perpendicDistFromLineSqrd(path[curr], path[prev], path[nextNext]);
        }
        if (isClosedPath || prev !== 0 && prev !== high) {
          dsq[prev] = perpendicDistFromLineSqrd(path[prev], path[prior2], path[curr]);
        }
      }
    }
    const result = [];
    for (let i = 0; i < len; i++) {
      if (!flags[i]) result.push(path[i]);
    }
    return result;
  }
  Clipper3.simplifyPathD = simplifyPathD2;
  function simplifyPathsD2(paths, epsilon, isClosedPath = true) {
    const result = [];
    for (const path of paths) {
      result.push(simplifyPathD2(path, epsilon, isClosedPath));
    }
    return result;
  }
  Clipper3.simplifyPathsD = simplifyPathsD2;
  function trimCollinear2(path, isOpen = false) {
    let len = path.length;
    let i = 0;
    if (!isOpen) {
      while (i < len - 1 && InternalClipper.isCollinear(path[len - 1], path[i], path[i + 1])) i++;
      while (i < len - 1 && InternalClipper.isCollinear(path[len - 2], path[len - 1], path[i])) len--;
    }
    if (len - i < 3) {
      if (!isOpen || len < 2 || Point64Utils.equals(path[0], path[1])) {
        return [];
      }
      return path;
    }
    const result = [];
    let last = path[i];
    result.push(last);
    for (i++; i < len - 1; i++) {
      if (InternalClipper.isCollinear(last, path[i], path[i + 1])) continue;
      last = path[i];
      result.push(last);
    }
    if (isOpen) {
      result.push(path[len - 1]);
    } else if (!InternalClipper.isCollinear(last, path[len - 1], result[0])) {
      result.push(path[len - 1]);
    } else {
      while (result.length > 2 && InternalClipper.isCollinear(
        result[result.length - 1],
        result[result.length - 2],
        result[0]
      )) {
        result.pop();
      }
      if (result.length < 3) {
        result.length = 0;
      }
    }
    return result;
  }
  Clipper3.trimCollinear = trimCollinear2;
  function trimCollinearD2(path, precision, isOpen = false) {
    InternalClipper.checkPrecision(precision);
    const scale = Math.pow(10, precision);
    let p = scalePath642(path, scale);
    p = trimCollinear2(p, isOpen);
    return scalePathDFromInt(p, 1 / scale);
  }
  Clipper3.trimCollinearD = trimCollinearD2;
  function pointInPolygon2(pt, polygon) {
    return InternalClipper.pointInPolygon(pt, polygon);
  }
  Clipper3.pointInPolygon = pointInPolygon2;
  function pointInPolygonD2(pt, polygon, precision = 2) {
    InternalClipper.checkPrecision(precision);
    const scale = Math.pow(10, precision);
    const p = Point64Utils.fromPointD(PointDUtils.scale(pt, scale));
    const pathScaled = scalePath642(polygon, scale);
    return InternalClipper.pointInPolygon(p, pathScaled);
  }
  Clipper3.pointInPolygonD = pointInPolygonD2;
  function ellipse2(center, radiusX, radiusY = 0, steps = 0) {
    if (radiusX <= 0) return [];
    if (radiusY <= 0) radiusY = radiusX;
    if (steps <= 2) {
      steps = Math.ceil(Math.PI * Math.sqrt((radiusX + radiusY) / 2));
    }
    const si = Math.sin(2 * Math.PI / steps);
    const co = Math.cos(2 * Math.PI / steps);
    let dx = co;
    let dy = si;
    const result = [{ x: Math.round(center.x + radiusX), y: center.y }];
    for (let i = 1; i < steps; ++i) {
      result.push({
        x: Math.round(center.x + radiusX * dx),
        y: Math.round(center.y + radiusY * dy)
      });
      const x = dx * co - dy * si;
      dy = dy * co + dx * si;
      dx = x;
    }
    return result;
  }
  Clipper3.ellipse = ellipse2;
  function ellipseD2(center, radiusX, radiusY = 0, steps = 0) {
    if (radiusX <= 0) return [];
    if (radiusY <= 0) radiusY = radiusX;
    if (steps <= 2) {
      steps = Math.ceil(Math.PI * Math.sqrt((radiusX + radiusY) / 2));
    }
    const si = Math.sin(2 * Math.PI / steps);
    const co = Math.cos(2 * Math.PI / steps);
    let dx = co;
    let dy = si;
    const result = [{ x: center.x + radiusX, y: center.y }];
    for (let i = 1; i < steps; ++i) {
      result.push({
        x: center.x + radiusX * dx,
        y: center.y + radiusY * dy
      });
      const x = dx * co - dy * si;
      dy = dy * co + dx * si;
      dx = x;
    }
    return result;
  }
  Clipper3.ellipseD = ellipseD2;
})(Clipper2 || (Clipper2 = {}));

// pkg/package/src/index.ts
var {
  intersect,
  intersectD,
  union,
  unionD,
  difference,
  differenceD,
  xor,
  xorD,
  booleanOp,
  booleanOpWithPolyTree,
  booleanOpD,
  booleanOpDWithPolyTree,
  inflatePaths,
  inflatePathsD,
  rectClip,
  rectClipLines,
  minkowskiSum,
  minkowskiSumD,
  minkowskiDiff,
  minkowskiDiffD,
  area,
  areaPaths,
  areaD,
  areaPathsD,
  isPositive,
  isPositiveD,
  getBounds,
  getBoundsPaths,
  getBoundsD,
  getBoundsPathsD,
  makePath,
  makePathD,
  scalePath64,
  scalePaths64,
  scalePathD,
  scalePathsD,
  translatePath,
  translatePaths,
  translatePathD,
  translatePathsD,
  reversePath,
  reversePathD,
  reversePaths,
  reversePathsD,
  stripDuplicates,
  trimCollinear,
  trimCollinearD,
  pointInPolygon,
  pointInPolygonD,
  ellipse,
  ellipseD,
  simplifyPath,
  simplifyPaths,
  simplifyPathD,
  simplifyPathsD,
  ramerDouglasPeucker,
  ramerDouglasPeuckerPaths,
  ramerDouglasPeuckerD,
  ramerDouglasPeuckerPathsD
} = Clipper2;
export {
  Active,
  ClipType,
  Clipper2 as Clipper,
  Clipper64,
  ClipperBase,
  ClipperD,
  ClipperEngine,
  ClipperOffset,
  EndType,
  FillRule,
  HorzJoin,
  HorzPosition,
  HorzSegment,
  InternalClipper,
  InvalidRect64,
  InvalidRectD,
  JoinType,
  JoinWith,
  LocalMinima,
  Minkowski,
  OutPt,
  OutPt2,
  OutRec,
  PathType,
  PathUtils,
  PathsUtils,
  Point64Utils,
  PointDUtils,
  PointInPolygonResult,
  PolyPath64,
  PolyPathBase,
  PolyPathD,
  PolyTree64,
  PolyTreeD,
  Rect64Utils,
  RectClip64,
  RectClipLines64,
  RectDUtils,
  ReuseableDataContainer64,
  Vertex,
  VertexFlags,
  area,
  areaD,
  areaPaths,
  areaPathsD,
  booleanOp,
  booleanOpD,
  booleanOpDWithPolyTree,
  booleanOpWithPolyTree,
  createIntersectNode,
  createLocalMinima,
  difference,
  differenceD,
  ellipse,
  ellipseD,
  getBounds,
  getBoundsD,
  getBoundsPaths,
  getBoundsPathsD,
  inflatePaths,
  inflatePathsD,
  intersect,
  intersectD,
  isPositive,
  isPositiveD,
  makePath,
  makePathD,
  minkowskiDiff,
  minkowskiDiffD,
  minkowskiSum,
  minkowskiSumD,
  pointInPolygon,
  pointInPolygonD,
  ramerDouglasPeucker,
  ramerDouglasPeuckerD,
  ramerDouglasPeuckerPaths,
  ramerDouglasPeuckerPathsD,
  rectClip,
  rectClipLines,
  reversePath,
  reversePathD,
  reversePaths,
  reversePathsD,
  scalePath64,
  scalePathD,
  scalePaths64,
  scalePathsD,
  simplifyPath,
  simplifyPathD,
  simplifyPaths,
  simplifyPathsD,
  stripDuplicates,
  translatePath,
  translatePathD,
  translatePaths,
  translatePathsD,
  trimCollinear,
  trimCollinearD,
  union,
  unionD,
  xor,
  xorD
};
