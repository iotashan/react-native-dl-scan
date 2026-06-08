#!/usr/bin/env python3
"""yolo_fields (YOLO txt, 640x640) -> COCO json for NanoDet. All images 640x640."""
import os, json, glob, sys
ROOT=os.environ.get("IDNET_DATA_ROOT","/Volumes/Work4TB/dev/iotashan/idnet-data")+"/yolo_fields"
NAMES=["birthday","card_num1","card_num2","country","donor","expire_date","face","gender","ghostimg","given_name","list_1","list_12","list_15","list_16","list_17","list_18","list_19","list_2","list_3","list_3c","list_4a","list_4b","list_4d","list_5","list_8f","list_8s","list_9","list_9a","personal_num","surname"]
assert len(NAMES)==30
S=640
def build(split):
    img_dir=f"{ROOT}/images/{split}"; lab_dir=f"{ROOT}/labels/{split}"
    images=[]; anns=[]; aid=1
    imgs=sorted(glob.glob(f"{img_dir}/*.jpg")+glob.glob(f"{img_dir}/*.png"))
    for iid,ip in enumerate(imgs,1):
        fn=os.path.basename(ip)
        images.append({"id":iid,"file_name":fn,"width":S,"height":S})
        lp=f"{lab_dir}/"+os.path.splitext(fn)[0]+".txt"
        if not os.path.exists(lp): continue
        for line in open(lp):
            p=line.split()
            if len(p)!=5: continue
            c=int(p[0]); cx,cy,w,h=(float(x) for x in p[1:])
            x=(cx-w/2)*S; y=(cy-h/2)*S; bw=w*S; bh=h*S
            anns.append({"id":aid,"image_id":iid,"category_id":c+1,
                "bbox":[round(x,2),round(y,2),round(bw,2),round(bh,2)],
                "area":round(bw*bh,2),"iscrowd":0}); aid+=1
    cats=[{"id":k+1,"name":n,"supercategory":"field"} for k,n in enumerate(NAMES)]
    out={"images":images,"annotations":anns,"categories":cats}
    os.makedirs(f"{ROOT}/coco",exist_ok=True)
    jp=f"{ROOT}/coco/instances_{split}.json"; json.dump(out,open(jp,"w"))
    print(f"{split}: {len(images)} images, {len(anns)} anns -> {jp}")
for sp in ("train","val"): build(sp)
print("COCO_CONVERT_DONE")
