#!/usr/bin/env python3
"""MPS-capable NanoDet trainer for the DL field detector.
NanoDet's tools/train.py only branches CPU vs CUDA; this adds MPS (Apple Silicon)
and injects dataset paths from $IDNET_DATA_ROOT so the config stays path-free.
Usage:
  IDNET_DATA_ROOT=/path python train_nanodet.py CONFIG.yml [--smoke] [--epochs N]
"""
import os, argparse, warnings
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK","1")
import pytorch_lightning as pl
import torch
from pytorch_lightning.callbacks import TQDMProgressBar, Callback
from nanodet.data.collate import naive_collate


class MpsCacheClear(Callback):
    """Periodically release the MPS allocator cache. Without this, NanoDet's
    per-iter MPS memory grows and the step time creeps up over an epoch
    (observed 1.9 -> 3.6+ s/iter on an M3 Ultra). Clearing every N steps keeps
    the rate flat at a tiny cost. No-op off MPS."""
    def __init__(self, every: int = 50):
        self.every = every
    def on_train_batch_end(self, trainer, pl_module, outputs, batch, batch_idx):
        if batch_idx % self.every == 0:
            try:
                torch.mps.empty_cache()
            except Exception:
                pass
from nanodet.data.dataset import build_dataset
from nanodet.evaluator import build_evaluator
from nanodet.trainer.task import TrainingTask
from nanodet.util import NanoDetLightningLogger, cfg, load_config, mkdir

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("config"); ap.add_argument("--smoke",action="store_true")
    ap.add_argument("--epochs",type=int,default=None); ap.add_argument("--seed",type=int,default=42); ap.add_argument("--cpu",action="store_true"); ap.add_argument("--resume",type=str,default=None,help="path to .ckpt to resume optimizer+epoch state from")
    a=ap.parse_args()
    load_config(cfg, a.config)
    root=os.environ["IDNET_DATA_ROOT"]+"/yolo_fields"
    cfg.defrost()
    train_ann = root+"/coco/instances_smoke.json" if a.smoke else root+"/coco/instances_train.json"
    val_ann   = root+"/coco/instances_smoke.json" if a.smoke else root+"/coco/instances_val.json"
    cfg.data.train.img_path=root+"/images/train"; cfg.data.train.ann_path=train_ann
    cfg.data.val.img_path=(root+"/images/train") if a.smoke else (root+"/images/val"); cfg.data.val.ann_path=val_ann
    if a.smoke: cfg.schedule.total_epochs=1; cfg.schedule.val_intervals=1; cfg.device.batchsize_per_gpu=8; cfg.device.workers_per_gpu=2; cfg.save_dir="workspace/smoke"
    if a.epochs: cfg.schedule.total_epochs=a.epochs
    cfg.log.interval=20
    cfg.freeze()
    mkdir(0,cfg.save_dir); logger=NanoDetLightningLogger(cfg.save_dir); logger.dump_cfg(cfg); pl.seed_everything(a.seed)
    if a.cpu: accel,devices="cpu",None
    elif torch.backends.mps.is_available(): accel,devices="mps",1
    elif torch.cuda.is_available(): accel,devices="gpu",cfg.device.gpu_ids
    else: accel,devices="cpu",None
    logger.info(f"accelerator={accel} devices={devices} epochs={cfg.schedule.total_epochs} bs={cfg.device.batchsize_per_gpu}")
    train_ds=build_dataset(cfg.data.train,"train"); val_ds=build_dataset(cfg.data.val,"test")
    ev=build_evaluator(cfg.evaluator,val_ds)
    tl=torch.utils.data.DataLoader(train_ds,batch_size=cfg.device.batchsize_per_gpu,shuffle=True,num_workers=cfg.device.workers_per_gpu,pin_memory=False,collate_fn=naive_collate,drop_last=True)
    vl=torch.utils.data.DataLoader(val_ds,batch_size=cfg.device.batchsize_per_gpu,shuffle=False,num_workers=cfg.device.workers_per_gpu,pin_memory=False,collate_fn=naive_collate,drop_last=False)
    task=TrainingTask(cfg,ev)
    trainer=pl.Trainer(default_root_dir=cfg.save_dir,max_epochs=cfg.schedule.total_epochs,
        check_val_every_n_epoch=cfg.schedule.val_intervals,accelerator=accel,devices=devices,
        log_every_n_steps=cfg.log.interval,num_sanity_val_steps=0,callbacks=[TQDMProgressBar(refresh_rate=0),MpsCacheClear(50)],
        logger=logger,benchmark=False,gradient_clip_val=cfg.get("grad_clip",0.0),precision=cfg.device.precision)
    if a.resume: logger.info(f"RESUMING from {a.resume}")
    trainer.fit(task,tl,vl,ckpt_path=a.resume)
    logger.info("TRAIN_FIT_DONE")

if __name__=="__main__": main()
