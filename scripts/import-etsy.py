#!/usr/bin/env python3
"""Convert an Etsy listing CSV to the storefront catalog without losing source fields."""
import argparse,csv,json,re
from pathlib import Path
from decimal import Decimal

def category(title):
 t=title.lower()
 groups=[('Fishing Gear',r'\breel\b|\brod\b|fishing|baitcast|spincast|tackle'),('Alabama & Sports Collectibles',r'alabama|crimson|bear bryant|saban|football|nba|basketball'),('Glass & Bottles',r'glass|bottle|decanter|mason jar|crystal|insulator'),('Tools & Workshop',r'drill|saw\b|winch|nailer|sander|pump|jack\b|impact driver|tool'),('Home & Decor',r'clock|lamp|decor|figurine|vase|plaque|sign\b|sculpture|frame|lantern'),('Kitchen & Table',r'china|dish|bowl|plate|skillet|kitchen|tea|casserole|coffee|porcelain')]
 return next((n for n,p in groups if re.search(p,t)), 'Vintage & Unique Finds')

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
  out.append({'id':sku or f'etsy-{len(out)+1}','sku':sku,'title':title,'description':desc,'price':float(price),'priceCents':int(price*100),'currency':row['CURRENCY_CODE'],'quantity':qty,'category':category(title),'tags':[v.strip() for v in row['TAGS'].split(',') if v.strip()],'materials':row['MATERIALS'],'images':images,'variations':variations,'pickupMentioned':pickup,'source':row})
 return out
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('--output',default='storefront/products.json');a=ap.parse_args();products=convert(a.source);Path(a.output).write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n');print(f'Imported {len(products)} products, {sum(len(p["images"]) for p in products)} image links, {sum(bool(p["variations"]) for p in products)} listings with variations.')
