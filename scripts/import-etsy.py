#!/usr/bin/env python3
"""Convert an Etsy listing CSV to the storefront catalog without losing source fields."""
import argparse,csv,json,re
from pathlib import Path
from decimal import Decimal

CATEGORIES=json.loads((Path(__file__).resolve().parents[1]/'storefront/categories.json').read_text())

def category(title, description=''):
 t=title.lower()
 if re.search(r'price guide|collector knives',t):return 'Miscellaneous'
 groups=[
 ('Vintage fishing and outdoors',r'\breel\b|\brod\b|fishing|baitcast|spincast|tackle|camping|hunting'),
 ('Vintage knifes',r'\bknife\b|\bknives\b|\bdagger\b|\bbayonet\b'),
 ('Vintage tools',r'drill|saw\b|winch|nailer|sander|vacuum pump|floor jack|impact driver|tool|angle grinder|staple gun'),
 ('Vintage electronics',r'barcode scanner|radio|speaker|karaoke|transistor|camera|cassette|turntable|stereo'),
 ('Antique jars and bottles',r'bottle|\bjar\b|\bjars\b|decanter|\bflask\b|glass jug'),
 ('Antique Dishes',r'china|dish|bowl|plate|skillet|kitchen|tea cup|teapot|tea.*set|casserole|coffee pot|percolator|saucer|platter|sugar|chip.*dip|serving tray|compote'),
 ('Vintage home decor and glassware',r'glass|crystal|clock|lamp|decor|figurine|vase|plaque|sign\b|sculpture|frame|framed|lantern|bust|insulator|planter|thermometer|cabinet|stein|pitcher|carafe|canister|mirror|art print|lithograph|portrait|wooden elephant')]
 if re.search(r'anchor hocking|holly berry|vintage indonesia|homer laughlin eggshell|locks of scotland',t):return 'Antique Dishes'
 return next((n for n,p in groups if re.search(p,t)), 'Miscellaneous')

def collections(title):
 showcase=bool(re.search(r'grandfather clock|chinese apothecary medicine cabinet|1915 railroad',title,re.I))
 featured=bool(re.search(r'mosaic stained glass|valmont royal wheat|lew.s mentor ats',title,re.I))
 return [name for name,on in [('Showcase',showcase),('Featured',featured)] if on]

def convert(source):
 with Path(source).open(encoding='utf-8-sig',newline='') as f: rows=list(csv.DictReader(f))
 out=[];seen=set()
 for row in rows:
  sku=row['SKU'].strip();key=sku or row['TITLE'].strip()
  if key in seen:raise ValueError('Duplicate product: '+key)
  seen.add(key)
  price=Decimal(row['PRICE']);qty=int(row['QUANTITY'])
  if price<0 or qty<0:raise ValueError('Negative price/quantity: '+key)
  images=list(dict.fromkeys(row[f'IMAGE{i}'].strip() for i in range(1,11) if row[f'IMAGE{i}'].strip()))
  title=row['TITLE'].strip();desc=row['DESCRIPTION'].strip()
  variations=[{'type':row.get(f'VARIATION {i} TYPE',''),'name':row.get(f'VARIATION {i} NAME',''),'values':row.get(f'VARIATION {i} VALUES','')} for i in range(1,4) if row.get(f'VARIATION {i} VALUES','')]
  # Distinguish pickup preference from a strict shipping restriction.
  pickup=bool(re.search(r'local pickup|pickup only|local.only',title+' '+desc,re.I))
  out.append({'id':sku or f'etsy-{len(out)+1}','sku':sku,'title':title,'description':desc,'price':float(price),'priceCents':int(price*100),'currency':row['CURRENCY_CODE'],'quantity':qty,'category':category(title,desc),'collections':collections(title),'tags':[v.strip() for v in row['TAGS'].split(',') if v.strip()],'materials':row['MATERIALS'],'images':images,'variations':variations,'pickupMentioned':pickup,'source':row})
 return out
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('--output',default='storefront/products.json');a=ap.parse_args();products=convert(a.source);Path(a.output).write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n');print(f'Imported {len(products)} products, {sum(len(p["images"]) for p in products)} image links, {sum(bool(p["variations"]) for p in products)} listings with variations.')
