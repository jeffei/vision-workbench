"""Integration checks against the running local server (start.command)."""
import unittest
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8765'


class DetectionAPI(unittest.TestCase):
    def request(self, **data):
        with (ROOT / 'web/assets/street.jpg').open('rb') as image:
            return requests.post(URL + '/api/detect', files={'file': image}, data=data, timeout=120)

    def test_invalid_image(self):
        response = requests.post(URL + '/api/detect', files={'file': ('bad.jpg', b'not an image')})
        self.assertEqual(response.status_code, 400)

    def test_empty_classes(self):
        self.assertEqual(self.request(classes=', ,').status_code, 400)

    def test_invalid_threshold(self):
        self.assertEqual(self.request(confidence='1.5').status_code, 400)

    def test_real_detection_and_threshold(self):
        low = self.request(classes='person,bus', confidence='0.25')
        self.assertEqual(low.status_code, 200, low.text)
        result = low.json()
        self.assertEqual((result['width'], result['height']), (810, 1080))
        self.assertGreater(len(result['detections']), 0)
        for d in result['detections']:
            self.assertIn(d['label'], ['person', 'bus'])
            self.assertGreaterEqual(d['confidence'], 0.25)
            x1, y1, x2, y2 = d['box']
            self.assertTrue(0 <= x1 < x2 <= 810)
            self.assertTrue(0 <= y1 < y2 <= 1080)
        high = self.request(classes='person,bus', confidence='0.95')
        self.assertEqual(high.status_code, 200, high.text)
        self.assertLessEqual(len(high.json()['detections']), len(result['detections']))

    def test_switch_vocabulary_after_prediction(self):
        for classes in ('person,bus', 'car,bicycle,person', 'person,bus'):
            response = self.request(classes=classes, confidence='0.25')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['classes'], classes.split(','))
            self.assertTrue(all(d['label'] in classes.split(',') for d in response.json()['detections']))

    def test_visual_requires_geometry_not_text(self):
        self.assertEqual(self.request(prompt_mode='visual', classes='').status_code, 400)
        bad = {'kind': 'box', 'regions': [[0, 0, 900, 100]]}
        self.assertEqual(self.request(prompt_mode='visual', visual=json.dumps(bad)).status_code, 400)

    def test_shape_remains_a_mask(self):
        from server import visual_prompts
        prompts = visual_prompts(json.dumps({'kind': 'shape', 'regions': [[[10, 10], [90, 10], [10, 90]]]}), (100, 100))
        self.assertNotIn('bboxes', prompts)
        self.assertEqual(prompts['masks'][0, 20, 20], 1)
        self.assertEqual(prompts['masks'][0, 80, 80], 0)

    def test_visual_box_and_shape(self):
        for geometry in ({'kind': 'box', 'regions': [[225, 407, 340, 856]]},
                         {'kind': 'shape', 'regions': [[[245, 410], [305, 410], [337, 565], [312, 850], [252, 850], [228, 550]]]}):
            response = self.request(prompt_mode='visual', classes='', visual=json.dumps(geometry))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['prompt_mode'], 'visual')
            self.assertGreater(len(response.json()['detections']), 0)
            self.assertTrue(all(d['label'] == 'object0' for d in response.json()['detections']))

    def test_visual_cross_image(self):
        with (ROOT / 'web/assets/street.jpg').open('rb') as ref, (ROOT / 'web/assets/sports.jpg').open('rb') as target:
            response = requests.post(URL + '/api/detect', files={'file': target, 'reference': ref},
                data={'prompt_mode': 'visual', 'classes': '', 'confidence': '0.1',
                      'visual': json.dumps({'kind': 'box', 'regions': [[225, 407, 340, 856]]})}, timeout=120)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['visual_usage'], 'cross-image')
        self.assertEqual(response.json()['width'], 1280)
        self.assertGreater(len(response.json()['detections']), 0)

    def test_z_prompt_free_then_text(self):
        response = self.request(prompt_mode='free', classes='')
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data['model'], 'YOLOE-v8-S-PF')
        self.assertEqual(len(data['classes']), 4585)
        self.assertGreater(len(data['detections']), 0)
        self.assertTrue(all(d['label'] in data['classes'] for d in data['detections']))
        self.assertEqual(self.request(classes='person,bus').status_code, 200)


if __name__ == '__main__':
    unittest.main()
