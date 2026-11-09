# Stand-in for gradio: LivePortrait's GradioPipeline only uses gr.Error / gr.Info / gr.Warning.
class Error(Exception):
    def __init__(self, msg="", duration=None):
        super().__init__(msg)
def Info(*a, **k): pass
def Warning(*a, **k): pass
