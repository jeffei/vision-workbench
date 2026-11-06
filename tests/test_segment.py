import base64
import io
import json
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from fastapi import HTTPException
import segment

class SegmentTests(unittest.TestCase):
    def test_point_and_box(self):
        self.assertEqual(segment.parse_prompts('{"points":[[20,30]],"labels":[1],"box":[0,0,80,90]}',(100,100),'prompt'), ([[20,30]],[1],[0,0,80,90]))

    def test_invalid_geometry(self):
        for value in [{}, {'points':[[100,20]],'labels':[1]}, {'points':[[20,20]],'labels':[2]}, {'points':[[20,20]],'labels':[]}, {'box':[50,0,20,10]}, {'points':[[float('nan'),10]],'labels':[1]}, []]:
            with self.subTest(value=value), self.assertRaises(HTTPException):
                segment.parse_prompts(json.dumps(value),(100,100),'prompt')

    def test_auto_accepts_no_prompts(self):
        self.assertEqual(segment.parse_prompts('{}',(100,100),'auto'),([],[],None))

    def test_mask_png_and_geometry(self):
        mask=np.zeros((20,30),dtype=bool);mask[3:10,5:15]=True
        record=segment.encode_mask(mask,.91,1)
        self.assertEqual(record['box'],[5,3,15,10]);self.assertEqual(record['area'],70)
        png=Image.open(io.BytesIO(base64.b64decode(record['png'])))
        self.assertEqual(png.size,(30,20));self.assertEqual(png.getpixel((6,4)),255)
        self.assertIsNone(segment.encode_mask(np.zeros_like(mask),.1,2))

if __name__=='__main__':unittest.main()
