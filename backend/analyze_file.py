import os
import subprocess
import json
import base64
from xml.etree import ElementTree as ET
import ezdxf
from svgpathtools import svg2paths2, parse_path, Path
from svgpathtools.parser import parse_transform


def svg_path_preview_dxf(obj, scale=1):
    width = max(obj["width"], 1)
    height = max(obj["height"], 1)

    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="0 0 {width} {height}"
         width="{width*scale}"
         height="{height*scale}">
      <rect x="0" y="0" width="{width}" height="{height}" fill="none" stroke="black" stroke-width="{max(width,height)*0.02}"/>
    </svg>
    """
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()

def analyze_dxf(file_path):
    doc = ezdxf.readfile(file_path)
    msp = doc.modelspace()
    objects = []

    for e in msp:
        if e.dxftype() in ["SPLINE", "LWPOLYLINE", "LINE", "CIRCLE", "ELLIPSE"]:
            if e.dxftype() == "SPLINE":
                points = e.control_points
            else:
                points = e.vertices() if hasattr(e, "vertices") else []

            if points:
                xs = [p[0] for p in points]
                ys = [p[1] for p in points]
                minx, maxx = min(xs), max(xs)
                miny, maxy = min(ys), max(ys)
            else:
                minx = miny = 0
                maxx = e.dxf.size if hasattr(e.dxf, "size") else 0
                maxy = maxx

            width = maxx - minx
            height = maxy - miny
            area = width * height

            obj = {
                "type": "DXF",
                "dxftype": e.dxftype(),
                "minx": minx,
                "miny": miny,
                "maxx": maxx,
                "maxy": maxy,
                "width": width,
                "height": height,
                "area": area,
            }

            # DXF için basit preview
            obj["preview"] = svg_path_preview_dxf(obj)

            objects.append(obj)

    # DXF için outer filtering kaldır (çünkü objeler iç içe değil)
    return objects

def analyze_svg(file_path):
    paths, attributes, svg_attr = svg2paths2(file_path)
    objects = []

    # --- SVG WIDTH / HEIGHT (mm veya px olabilir) ---
    def parse_size(val):
        if val is None:
            return None
        val = str(val)
        if val.endswith("mm"):
            return float(val.replace("mm", ""))
        if val.endswith("px"):
            return float(val.replace("px", "")) * 0.264583  # px → mm
        return float(val)  # çıplak sayı → mm varsay

    svg_w_mm = parse_size(svg_attr.get("width"))
    svg_h_mm = parse_size(svg_attr.get("height"))

    if "viewBox" not in svg_attr:
        raise ValueError("SVG viewBox yok, ölçü hesaplanamaz")

    vb_minx, vb_miny, vb_w, vb_h = map(float, svg_attr["viewBox"].split())

    # ! eskisi silindi
    # --- SCALE (viewBox → mm) ---
    # scale_x = svg_w_mm / vb_w if svg_w_mm else 1
    # scale_y = svg_h_mm / vb_h if svg_h_mm else 1
    # !

    # !yeni eklendi
    # --- SCALE (viewBox → mm) ---
    if svg_w_mm and svg_h_mm:
        # Illustrator / düzgün SVG
        scale_x = svg_w_mm / vb_w
        scale_y = svg_h_mm / vb_h
    else:
        # AutoCAD SVG → viewBox px kabul edilir
        PX_TO_MM = 25.4 / 72.0  # 1 px ≈ 0.3527 mm (SVG standard)
        scale_x = PX_TO_MM
        scale_y = PX_TO_MM
    # !

    # --- PATH BBOX'LARI ---
    for path in paths:
        xmin, xmax, ymin, ymax = path.bbox()

        minx = xmin * scale_x
        maxx = xmax * scale_x
        miny = ymin * scale_y
        maxy = ymax * scale_y
        width = maxx - minx
        height = maxy - miny


        # 🔹 TABLO PREVIEW (SADECE BBOX)
        preview_bbox = svg_path_preview(
            path,
            (xmin, xmax, ymin, ymax),
            scale=3,
            flip_y=False
        )

        # 🔹 GLOBAL PREVIEW (MERGE İÇİN)
        preview_global = svg_path_preview(
            path,
            (xmin, xmax, ymin, ymax),
            scale=1,
            flip_y=False
        )
        
        objects.append({
            "type": "SVG",

            # 🔹 GLOBAL KOORDİNAT
            "minx": minx,
            "miny": miny,
            "maxx": maxx,
            "maxy": maxy,

            # 🔹 LOCAL BBOX
            "width": width,
            "height": height,
            "area": width * height,
            "description": '',

            # 🔹 PREVIEWLER
            "preview": preview_bbox,           # tablo
            "preview_global": preview_global,  # merge
        })
    return objects

def filter_outer_objects(objects):
    outer = []
    for i, obj in enumerate(objects):
        is_inner = False
        obj_minx = obj.get("minx", 0)
        obj_miny = obj.get("miny", 0)
        obj_maxx = obj_minx + obj["width"]
        obj_maxy = obj_miny + obj["height"]

        for j, other in enumerate(objects):
            if i == j:
                continue
            other_minx = other.get("minx", 0)
            other_miny = other.get("miny", 0)
            other_maxx = other_minx + other["width"]
            other_maxy = other_miny + other["height"]

            if (obj_minx >= other_minx and obj_miny >= other_miny and
                obj_maxx <= other_maxx and obj_maxy <= other_maxy):
                is_inner = True
                break

        if not is_inner:
            outer.append(obj)
    return outer

def analyze_file(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".dxf":
        objects = filter_outer_objects(analyze_dxf(file_path))
    elif ext == ".svg":
        objects = analyze_svg(file_path)
    elif ext == ".ai":
        objects = analyze_ai_as_svg(file_path)
    else:
        raise ValueError("Unsupported file type")

    # outer_objects = filter_outer_objects(objects)
    # return outer_objects
    return objects

def svg_path_preview(path, bbox, scale, flip_y=False):
    xmin, xmax, ymin, ymax = bbox
    w = xmax - xmin
    h = ymax - ymin

    if w <= 0 or h <= 0:
        w, h = 1, 1

    transform = (
        f'translate(0,{ymin + ymax}) scale(1,-1)'
        if flip_y else ''
    )

    svg = f"""
    <svg xmlns="http://www.w3.org/2000/svg"
         viewBox="{xmin} {ymin} {w} {h}"
         width="{w * scale}"
         height="{h * scale}">
      <g transform="{transform}">
        <path d="{path.d()}"
              fill="none"
              stroke="black"
              stroke-width="{max(w,h) * 0.0045}" />
      </g>
    </svg>
    """

    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()

def get_global_transform(el):
    transform = None
    while el is not None:
        t = el.attrib.get("transform")
        if t:
            m = parse_transform(t)
            transform = m if transform is None else m * transform
        el = el.getparent() if hasattr(el, "getparent") else None
    return transform

def apply_transform_to_path(sp, transform):
    # transform yoksa veya boşsa orijinali döndür
    if transform is None:
        return sp
    # Eğer string değilse, boş string gibi davran
    if not isinstance(transform, str):
        transform_str = ""
    else:
        transform_str = transform.strip()
    if not transform_str:
        return sp

    # parse ve uygula
    transform_matrix = parse_transform(transform_str)
    new_segments = [seg.transformed(transform_matrix) for seg in sp]
    return Path(*new_segments)

def analyze_ai_as_svg(file_path):
    svg_path = file_path.replace(".ai", ".svg")
    subprocess.run([
        "inkscape", file_path,
        "--export-plain-svg",
        "--export-filename", svg_path
    ], check=True)

    tree = ET.parse(svg_path)
    root = tree.getroot()

    vb_minx, vb_miny, vb_w, vb_h = map(float, root.attrib["viewBox"].split())
    PT_TO_MM = 25.4 / 72.0

    objects = []
    seen_boxes = set()

    def process_element(el):
        if el.tag.endswith("path"):
            d = el.attrib.get("d")
            if not d:
                return

            sp_raw = parse_path(d)
            transform = get_global_transform(el)
            sp = apply_transform_to_path(sp_raw, transform)

            xmin, xmax, ymin, ymax = sp.bbox()
            key = (round(xmin,2), round(ymin,2), round(xmax,2), round(ymax,2))
            if key in seen_boxes:
                return
            seen_boxes.add(key)

            # GLOBAL mm ölçü
            minx = xmin * PT_TO_MM
            maxx = xmax * PT_TO_MM
            miny = (vb_h - ymax) * PT_TO_MM
            maxy = (vb_h - ymin) * PT_TO_MM

            width = maxx - minx
            height = maxy - miny

            preview = svg_path_preview(
                sp,
                (xmin, xmax, ymin, ymax),
                scale=3,
                flip_y=True
            )
            preview_global = svg_path_preview(
                sp,
                (xmin, xmax, ymin, ymax),
                scale=1,
                flip_y=True
            )

            objects.append({
                "type": "AI",
                "minx": minx,
                "miny": miny,
                "maxx": maxx,
                "maxy": maxy,
                "width": width,
                "height": height,
                "area": width * height,
                "description": '',
                "preview": preview,
                "preview_global": preview_global,
            })

        for child in el:
            process_element(child)

    process_element(root)
    return objects[1:] if len(objects) > 1 else objects


if __name__ == "__main__":
    import sys
    import json

    file_path = sys.argv[1]
    result = analyze_file(file_path)

    print(json.dumps(result))
