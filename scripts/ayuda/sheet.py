import sys, glob, os
from PIL import Image, ImageDraw
d=sys.argv[1]; out=sys.argv[2]; cols=int(sys.argv[3]) if len(sys.argv)>3 else 5
fs=sorted(glob.glob(d+'/*.png'), key=lambda f:int(os.path.basename(f).split('.')[0]))
W=300
ims=[]
for f in fs:
    im=Image.open(f); im=im.resize((W, int(im.height*W/im.width))); ims.append((os.path.basename(f),im))
rows=(len(ims)+cols-1)//cols
H=max(i.height for _,i in ims)+24
sh=Image.new('RGB',(cols*(W+10),rows*H),'white'); dr=ImageDraw.Draw(sh)
for k,(n,im) in enumerate(ims):
    x=(k%cols)*(W+10); y=(k//cols)*H
    sh.paste(im,(x,y+20)); dr.text((x+4,y+4),n,fill='black')
sh.save(out)
