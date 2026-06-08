# NanoDet torch-2.x patches (applied to the cloned/editable install)

NanoDet (RangiLyu/nanodet @ be9b4a9) is torch-1.x vintage. To run on torch 2.2.2:

1. `nanodet/data/collate.py:19` — `from torch._six import string_classes` →
   `string_classes = (str, bytes)` (torch._six was removed in torch 2.0).

(More patches appended here as training surfaces them.)

2. `nanodet/model/head/gfl_head.py:66` (Integral.forward) — `F.linear(x, project)` on a (..,4,8)@(8,) shape trips an MPS matmul bug ("contracting dimensions differ 4 & 8"). Reformulated as `(x * project).sum(dim=-1)` (identical DFL integral, no matmul, MPS-safe).
