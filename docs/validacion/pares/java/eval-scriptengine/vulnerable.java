import javax.script.*;
import org.springframework.web.bind.annotation.*;

@RestController
public class CalculoController {
    @GetMapping("/calcular")
    public Object calcular(@RequestParam String expresion) throws ScriptException {
        ScriptEngine engine = new ScriptEngineManager().getEngineByName("javascript");
        return engine.eval(expresion);
    }
}
